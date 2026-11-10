const SUPABASE_URL = "https://anlgfcltudysjnsipsmd.supabase.co";

const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x6V-O5rj20gGsoJSlbTsBw_kVuICTBv";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const APP_SITE_URL = "https://breakfastbox.github.io/food-stall-platform/";
let currentStallId = null;
let currentUserRole = null;
let currentStallRecord = null;

function showPasswordRecoveryForm() {
  const loginBox = document.getElementById("loginBox");
  const dashboard = document.getElementById("dashboard");
  const recoveryBox = document.getElementById("passwordRecoveryBox");
  if (!recoveryBox) return;
  if (loginBox) loginBox.style.display = "none";
  if (dashboard) dashboard.style.display = "none";
  recoveryBox.style.display = "block";
}

function isPasswordSetupUrl() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.get("setup") === "password" ||
    query.get("type") === "recovery" ||
    hash.get("type") === "recovery" ||
    hash.get("type") === "invite";
}

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && isPasswordSetupUrl())) {
    showPasswordRecoveryForm();
  }
});

if (isPasswordSetupUrl()) {
  showPasswordRecoveryForm();
}

async function requestPasswordReset(emailInputId, messageId) {
  const email = document.getElementById(emailInputId)?.value.trim();
  const message = document.getElementById(messageId);
  if (!email) {
    if (message) message.textContent = "Enter your email address first.";
    return;
  }

  if (message) message.textContent = "Sending password reset email...";
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: APP_SITE_URL
  });

  if (message) {
    message.textContent = error
      ? "Unable to send reset email: " + error.message
      : "Password reset email sent. Open the link in that email to set a new password.";
  }
}

async function completePasswordReset() {
  const password = document.getElementById("newPassword")?.value || "";
  const confirmation = document.getElementById("confirmNewPassword")?.value || "";
  const message = document.getElementById("passwordRecoveryMessage");

  if (password.length < 8) {
    message.textContent = "Use a password with at least 8 characters.";
    return;
  }
  if (password !== confirmation) {
    message.textContent = "The passwords do not match.";
    return;
  }

  message.textContent = "Saving your new password...";
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) {
    message.textContent = "Unable to update password: " + error.message;
    return;
  }

  await supabaseClient.auth.signOut();
  const fields = document.getElementById("passwordRecoveryFields");
  if (fields) fields.style.display = "none";
  const returnButton = document.getElementById("returnToLoginButton");
  if (returnButton) returnButton.style.display = "inline-block";
  message.textContent = "Password updated successfully. You can now return to login and sign in with your new password.";
  window.history.replaceState({}, document.title, window.location.pathname);
}

function returnToLogin() {
  const recoveryBox = document.getElementById("passwordRecoveryBox");
  const loginBox = document.getElementById("loginBox");
  if (recoveryBox) recoveryBox.style.display = "none";
  if (loginBox) loginBox.style.display = "block";
  const fields = document.getElementById("passwordRecoveryFields");
  if (fields) fields.style.display = "block";
  const returnButton = document.getElementById("returnToLoginButton");
  if (returnButton) returnButton.style.display = "none";
  const message = document.getElementById("passwordRecoveryMessage");
  if (message) message.textContent = "";
}

async function getCurrentStallContext() {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !user) throw new Error("Please sign in to continue.");

  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("id, role, stall_id, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw new Error("Could not verify your account: " + profileError.message);
  if (!profile) throw new Error("Your account profile is not set up. Please contact the platform administrator.");

  let stallQuery = supabaseClient
    .from("stalls")
    .select("id, name, status, ordering_enabled, logo_url, upi_id, upi_account_name")
    .limit(1);

  if (profile.role === "admin") {
    // Platform Admin may open a specific stall from the admin stall list.
    // Without a stall_id, preserve the default Breakfast Box dashboard.
    const requestedStallId = new URLSearchParams(window.location.search).get("stall_id");
    stallQuery = requestedStallId
      ? stallQuery.eq("id", requestedStallId)
      : stallQuery.eq("name", "Breakfast Box");
  } else if (["stall_owner", "staff"].includes(profile.role) && profile.stall_id) {
    stallQuery = stallQuery.eq("id", profile.stall_id);
  } else {
    throw new Error("This account does not have stall dashboard access.");
  }

  const { data: stall, error: stallError } = await stallQuery.maybeSingle();
  if (stallError) throw new Error("Could not load your assigned stall: " + stallError.message);
  if (!stall) throw new Error("No stall is assigned to this account.");

  currentStallId = stall.id;
  currentUserRole = profile.role;
  currentStallRecord = stall;
  return { user, profile, stall };
}

let knownOrderIdsForAlerts = null;
let orderSoundAlertsEnabled = false;
let orderAlertAudioContext = null;
let orderAlertRepeatTimer = null;
let pendingOrderAlerts = new Map();
let acknowledgedOrderAlertIds = new Set();
let orderAlertCursor = 0;
let orderBrowserNotificationsEnabled =
  "Notification" in window &&
  Notification.permission === "granted";

async function enableBrowserOrderNotifications() {
  const button = document.getElementById(
    "enableBrowserNotificationsButton"
  );
  const status = document.getElementById(
    "browserNotificationStatus"
  );

  try {
    if (!("Notification" in window)) {
      throw new Error("Browser notifications are not supported.");
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      throw new Error("Notification permission was not granted.");
    }

    orderBrowserNotificationsEnabled = true;

    if (button) {
      button.textContent = "Browser Notifications Enabled";
      button.disabled = true;
    }

    if (status) {
      status.textContent = "New order notifications are enabled.";
    }

    new Notification("Breakfast Box", {
      body: "New order notifications are ready!"
    });

  } catch (error) {
    console.error("Notification setup failed:", error);

    if (status) {
      status.textContent = error.message;
    }
  }
}

function showNewOrderNotification(order) {
  if (
    !orderBrowserNotificationsEnabled ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) return;

  const token = order.token_number == null
    ? "Not assigned"
    : String(order.token_number).padStart(4, "0");

  new Notification("New Breakfast Box Order!", {
    body:
      "Token: " + token +
      " | Total: ₹" + Number(order.total_amount || 0).toFixed(2),
    tag: "breakfast-order-" + order.id
  });
}
function playNewOrderSound() {
  if (!orderSoundAlertsEnabled || !orderAlertAudioContext) return;

  const now = orderAlertAudioContext.currentTime;
  [1046, 784, 1046].forEach((frequency, index) => {
    const start = now + index * 0.19;
    const oscillator = orderAlertAudioContext.createOscillator();
    const gain = orderAlertAudioContext.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.32, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.connect(gain);
    gain.connect(orderAlertAudioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.17);
  });
}

function speakNewOrderAnnouncement(order) {
  if (!orderSoundAlertsEnabled || !("speechSynthesis" in window)) return;
  const token = order.token_number == null
    ? "not assigned"
    : String(order.token_number).padStart(4, "0");
  const utterance = new SpeechSynthesisUtterance(
    "New order received. Token number " + token + "."
  );
  utterance.lang = "en-IN";
  utterance.rate = 0.92;
  utterance.pitch = 1;
  utterance.volume = 1;
  const voices = window.speechSynthesis.getVoices();
  const indianEnglishVoice = voices.find(voice =>
    /^en-IN$/i.test(voice.lang)
  );
  if (indianEnglishVoice) utterance.voice = indianEnglishVoice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function runOrderAlertCycle() {
  if (!orderSoundAlertsEnabled || pendingOrderAlerts.size === 0) return;
  const pendingOrders = Array.from(pendingOrderAlerts.values());
  const nextOrder = pendingOrders[orderAlertCursor % pendingOrders.length];
  orderAlertCursor += 1;
  playNewOrderSound();
  window.setTimeout(() => speakNewOrderAnnouncement(nextOrder), 650);
}

function startOrderAlertLoop() {
  if (pendingOrderAlerts.size === 0 || orderAlertRepeatTimer) return;
  runOrderAlertCycle();
  orderAlertRepeatTimer = window.setInterval(runOrderAlertCycle, 9000);
}

function stopPendingOrderAlert(orderId) {
  acknowledgedOrderAlertIds.add(orderId);
  pendingOrderAlerts.delete(orderId);
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (pendingOrderAlerts.size === 0) {
    if (orderAlertRepeatTimer) window.clearInterval(orderAlertRepeatTimer);
    orderAlertRepeatTimer = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }
}

async function enableOrderSoundAlerts() {
  const button = document.getElementById("enableOrderSoundButton");
  const status = document.getElementById("orderSoundStatus");

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Sound alerts are not supported by this browser.");
    if (!orderAlertAudioContext) orderAlertAudioContext = new AudioContextClass();
    await orderAlertAudioContext.resume();

    if (!("speechSynthesis" in window)) {
      throw new Error("Voice announcements are not supported by this browser. Please use Chrome or Edge.");
    }

    orderSoundAlertsEnabled = true;
    if (button) {
      button.textContent = "Loud Voice Alerts Enabled";
      button.disabled = true;
    }
    if (status) {
      status.textContent = "Loud alarm and spoken token announcements repeat every 9 seconds until each order is acted on.";
    }
    startOrderAlertLoop();
  } catch (error) {
    console.error("Could not enable voice order alerts:", error);
    if (status) status.textContent = error.message;
  }
}
async function setOrderingEnabled(action) {
  const {
    data: { session },
    error: sessionError
  } = await supabaseClient.auth.getSession();

  if (sessionError || !session) {
    throw new Error("Please sign in again.");
  }

  const { data, error } = await supabaseClient.functions.invoke(
    "manage-ordering",
    {
      body: { action },
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    }
  );

  if (error) {
    throw new Error("Could not update ordering. Please try again.");
  }

  if (!data?.success) {
    throw new Error(data?.error || "Could not update ordering.");
  }

  return data;
}


async function loginStallOwner() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const loginMessage = document.getElementById("loginMessage");

  loginMessage.textContent = "Logging in...";
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    loginMessage.textContent = "Login failed: " + error.message;
    return;
  }

  try {
    await getCurrentStallContext();

    // Token sequence resets only on a stall owner's first login on a later India date.
    // Midnight and same-day logout/login do not reset the counter.
    if (["stall_owner", "staff"].includes(currentUserRole)) {
      const { error: tokenSessionError } = await supabaseClient.rpc(
        "start_stall_token_session",
        { p_stall_id: currentStallId }
      );
      if (tokenSessionError) {
        throw new Error("Could not initialize the stall token sequence: " + tokenSessionError.message);
      }
    }

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
    loginMessage.textContent = "";
    await loadStallDashboard();
    await loadMenuCategories();
    await loadCategoriesForEditing();
  } catch (error) {
    await supabaseClient.auth.signOut();
    loginMessage.textContent = error.message;
  }
}

async function logoutStallOwner() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    alert("Logout failed: " + error.message);
    return;
  }

  currentStallId = null;
  currentUserRole = null;
  currentStallRecord = null;
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("loginBox").style.display = "block";
  const message = document.getElementById("loginMessage");
  if (message) message.textContent = "";
}

async function loginAdmin() {

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const loginMessage = document.getElementById("loginMessage");

  loginMessage.textContent = "Logging in...";

  const { data, error } =
    await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });

  if (error) {
    loginMessage.textContent =
      "Login failed: " + error.message;
    return;
  }

  // The root page is reserved for Platform Admin accounts.
  // A valid stall-owner password must never open the admin dashboard.
  try {
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error("Could not verify your account. Please sign in again.");
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw new Error("Could not verify account permissions: " + profileError.message);
    if (!profile || profile.role !== "admin") {
      await supabaseClient.auth.signOut();
      loginMessage.textContent = "This is a stall-owner account. Please sign in from the Stall Dashboard page.";
      return;
    }
  } catch (roleError) {
    await supabaseClient.auth.signOut();
    loginMessage.textContent = roleError.message || "This account does not have Platform Admin access.";
    return;
  }

  try {
    await setOrderingEnabled("resume");
  } catch (error) {
    // Keep the Platform Admin signed in so an expired or suspended stall
    // can still be renewed from the Admin Dashboard.
    console.warn("Ordering was not resumed:", error.message);
  }

  document.getElementById("loginBox").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  loginMessage.textContent = "";

  await loadStalls();
  await loadStallApplications();

}




async function logoutAdmin() {
  try {
    await setOrderingEnabled("pause");
  } catch (error) {
    alert(error.message || "Could not pause ordering. You are still logged in.");
    return;
  }

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    try {
      await setOrderingEnabled("resume");
    } catch (resumeError) {
      console.error("Could not resume ordering:", resumeError);
    }

    alert("Logout failed. Please try again.");
    return;
  }

  document.getElementById("dashboard").style.display = "none";
  document.getElementById("loginBox").style.display = "block";

  const loginMessage = document.getElementById("loginMessage");
  if (loginMessage) {
    loginMessage.textContent = "";
  }
}



function formatSubscriptionDate(dateString) {
  if (!dateString) return "Not set";

  const parts = dateString.split("-");
  if (parts.length !== 3) return dateString;

  return parts[2] + "-" + parts[1] + "-" + parts[0];
}

function getIndiaDateInputValue() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type)?.value || "";
  return part("year") + "-" + part("month") + "-" + part("day");
}

function getSubscriptionStatusInfo(stall) {
  const status = String(stall.status || "unknown").toLowerCase();
  if (!stall.subscription_end) {
    return { key: status, label: status.replace(/^./, c => c.toUpperCase()), daysRemaining: null };
  }

  const endParts = stall.subscription_end.split("-").map(Number);
  const todayParts = getIndiaDateInputValue().split("-").map(Number);
  if (endParts.length !== 3 || todayParts.length !== 3 ||
      endParts.some(Number.isNaN) || todayParts.some(Number.isNaN)) {
    return { key: status, label: status.replace(/^./, c => c.toUpperCase()), daysRemaining: null };
  }

  const endUtc = Date.UTC(endParts[0], endParts[1] - 1, endParts[2]);
  const todayUtc = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]);
  const daysRemaining = Math.round((endUtc - todayUtc) / 86400000);

  if (daysRemaining < 0 && ["active", "trial", "suspended", "expired"].includes(status)) {
    return { key: "expired", label: "Expired", daysRemaining };
  }
  if (status === "expired") {
    return { key: "expired", label: "Expired", daysRemaining };
  }
  if (status === "trial" && daysRemaining >= 0) {
    return {
      key: "trial",
      label: daysRemaining === 0 ? "Trial — ends today" : `Trial — ${daysRemaining} day(s) left`,
      daysRemaining
    };
  }
  if (daysRemaining >= 0 && daysRemaining <= 7 && status === "active") {
    return { key: "expiring_soon", label: "Expiring Soon", daysRemaining };
  }

  return {
    key: status,
    label: status.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()),
    daysRemaining
  };
}

function getSubscriptionRemainingText(endDate) {
  if (!endDate) return "No end date set";
  const parts = endDate.split("-").map(Number);
  const todayParts = getIndiaDateInputValue().split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return "Date unavailable";
  const endUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const todayUtc = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]);
  const difference = Math.round((endUtc - todayUtc) / 86400000);
  if (difference < 0) return "Expired " + Math.abs(difference) + " day(s) ago";
  if (difference === 0) return "Ends today";
  return difference + " day(s) remaining";
}

function getLocalDateInputValue() {
  const today = new Date();
  return String(today.getFullYear()) + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");
}

function getOneMonthSubscriptionEnd(startDate) {
  const parts = String(startDate || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return "";
  const [year, month, day] = parts;
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const targetYear = nextMonth.getUTCFullYear();
  const targetMonth = nextMonth.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  const end = new Date(Date.UTC(targetYear, targetMonth, clampedDay) - 86400000);
  return end.getUTCFullYear() + "-" +
    String(end.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(end.getUTCDate()).padStart(2, "0");
}

async function loadSubscriptionPaymentStalls(stalls) {
  const select = document.getElementById("subscriptionPaymentStall");
  if (!select) return;

  const previousValue = select.value;
  select.replaceChildren(new Option("Select a stall", ""));

  (stalls || []).forEach(stall => {
    select.add(new Option(stall.name, stall.id));
  });

  if (previousValue && (stalls || []).some(stall => stall.id === previousValue)) {
    select.value = previousValue;
  } else if (stalls && stalls.length) {
    select.value = stalls[0].id;
  }

  const amountInput = document.getElementById("subscriptionPaymentAmount");
  if (amountInput && (!amountInput.value || Number(amountInput.value) <= 0)) {
    amountInput.value = "499";
  }

  const today = getIndiaDateInputValue();
  const paymentDateInput = document.getElementById("subscriptionPaymentDate");
  const periodStartInput = document.getElementById("subscriptionPeriodStart");
  const periodEndInput = document.getElementById("subscriptionPeriodEnd");

  if (paymentDateInput && !paymentDateInput.value) paymentDateInput.value = today;
  if (periodStartInput && !periodStartInput.value) periodStartInput.value = today;
  if (periodEndInput && (!periodEndInput.value ||
      periodEndInput.value === periodStartInput?.value)) {
    periodEndInput.value = getOneMonthSubscriptionEnd(periodStartInput?.value || today);
  }

  if (periodStartInput && !periodStartInput.dataset.endDateLinked) {
    periodStartInput.addEventListener("change", () => {
      if (periodEndInput) {
        periodEndInput.value = getOneMonthSubscriptionEnd(periodStartInput.value);
      }
    });
    periodStartInput.dataset.endDateLinked = "true";
  }

  await loadSubscriptionPayments();
}

async function loadSubscriptionPayments() {
  const select = document.getElementById("subscriptionPaymentStall");
  const history = document.getElementById("subscriptionPaymentHistory");
  if (!select || !history) return;

  const stallId = select.value;
  if (!stallId) {
    history.innerHTML = '<div class="payment-empty-state"><span>▤</span><strong>No stall selected</strong><p>Select a food stall to see its payment records.</p></div>';
    return;
  }

  history.innerHTML = '<div class="payment-loading">Loading payment history…</div>';
  const { data, error } = await supabaseClient
    .from("subscription_payments")
    .select("id, amount, payment_method, transaction_reference, paid_at, period_start, period_end, notes, created_at")
    .eq("stall_id", stallId)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load subscription payments:", error);
    history.textContent = "Unable to load payment history: " + error.message;
    return;
  }

  if (!data || data.length === 0) {
    history.innerHTML = '<div class="payment-empty-state"><span>₹</span><strong>No payments yet</strong><p>Payments recorded for this stall will appear here.</p></div>';
    return;
  }

  const methodLabels = {
    upi: "UPI",
    bank_transfer: "Bank Transfer"
  };

  history.innerHTML = `
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Paid On</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Reference</th>
            <th>Subscription Period</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(payment => `
            <tr>
              <td>${formatSubscriptionDate(payment.paid_at)}</td>
              <td>₹${Number(payment.amount).toFixed(2)}</td>
              <td>${methodLabels[payment.payment_method] || escapeHtml(payment.payment_method)}</td>
              <td>${escapeHtml(payment.transaction_reference || "—")}</td>
              <td>${formatSubscriptionDate(payment.period_start)} to ${formatSubscriptionDate(payment.period_end)}</td>
              <td>${escapeHtml(payment.notes || "—")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function recordSubscriptionPayment() {
  const message = document.getElementById("subscriptionPaymentMessage");
  const stallId = document.getElementById("subscriptionPaymentStall")?.value;
  const amount = Number(document.getElementById("subscriptionPaymentAmount")?.value);
  const method = document.getElementById("subscriptionPaymentMethod")?.value;
  const paidAt = document.getElementById("subscriptionPaymentDate")?.value;
  const periodStart = document.getElementById("subscriptionPeriodStart")?.value;
  const periodEnd = document.getElementById("subscriptionPeriodEnd")?.value;
  const reference = document.getElementById("subscriptionPaymentReference")?.value || "";
  const notes = document.getElementById("subscriptionPaymentNotes")?.value || "";

  if (!stallId || !Number.isFinite(amount) || amount <= 0 || !method ||
      !paidAt || !periodStart || !periodEnd || periodEnd < periodStart) {
    message.textContent = "Please complete the required fields and check the dates and amount.";
    return;
  }

  const confirmed = window.confirm(
    "Record ₹" + amount.toFixed(2) + " by " +
    ({upi:"UPI",bank_transfer:"Bank Transfer"}[method] || method) +
    " and activate this stall from " + periodStart + " to " + periodEnd + "?"
  );
  if (!confirmed) return;

  const button = document.querySelector('button[onclick="recordSubscriptionPayment()"]');
  if (button) button.disabled = true;
  message.textContent = "Saving payment...";

  try {
    const { data, error } = await supabaseClient.rpc("record_subscription_payment", {
      p_stall_id: stallId,
      p_amount: amount,
      p_payment_method: method,
      p_transaction_reference: reference,
      p_paid_at: paidAt,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_notes: notes
    });

    if (error) throw error;
    if (!data) throw new Error("The payment was not saved. Please refresh and check the history.");

    document.getElementById("subscriptionPaymentAmount").value = "499";
    document.getElementById("subscriptionPaymentReference").value = "";
    document.getElementById("subscriptionPaymentNotes").value = "";
    message.textContent = periodEnd < getIndiaDateInputValue()
      ? "Payment recorded. The selected subscription period has already ended, so the stall remains Expired. Enter a current or future subscription period to reactivate it."
      : "Payment recorded successfully. The stall subscription is now Active.";

    await loadStalls();
    await loadStallApplications();
    await loadSubscriptionPayments();
  } catch (error) {
    console.error("Could not record subscription payment:", error);
    message.textContent = "Unable to record payment: " + error.message;
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadStalls(preselectPaymentStallId = null) {

  const { data, error } = await supabaseClient
    .from("stalls")
    .select(
      "id, name, owner_name, phone, status, address, subscription_start, subscription_end"
    )
    .order("created_at", { ascending: false });


  if (error) {

    console.error(error);

    document.getElementById("stallList").textContent =
      "Unable to load stalls: " + error.message;

    const subscriptionList = document.getElementById("subscriptionList");
    if (subscriptionList) {
      subscriptionList.textContent = "Unable to load subscription details.";
    }

    return;
  }


  document.getElementById("totalStalls").textContent =
    data.length;

  const subscriptionStates = data.map(stall => getSubscriptionStatusInfo(stall));
  document.getElementById("activeStalls").textContent =
    subscriptionStates.filter(state => state.key === "active").length;

  document.getElementById("trialStalls").textContent =
    subscriptionStates.filter(state => state.key === "trial").length;

  document.getElementById("expiringSoonStalls").textContent =
    subscriptionStates.filter(state => state.key === "expiring_soon").length;

  document.getElementById("expiredStalls").textContent =
    subscriptionStates.filter(state => state.key === "expired").length;

  document.getElementById("suspendedStalls").textContent =
    subscriptionStates.filter(state => state.key === "suspended").length;


  const subscriptionList = document.getElementById("subscriptionList");

  if (subscriptionList) {
    if (data.length === 0) {
      subscriptionList.textContent = "No subscription records yet.";
    } else {
      subscriptionList.innerHTML = data.map(stall => {
        const subscriptionState = getSubscriptionStatusInfo(stall);

        return `
          <div class="stall subscription-card">
            <h3>${escapeHtml(stall.name)}</h3>
            <p><strong>Subscription status:</strong> <span class="status">${subscriptionState.label}</span></p>
            <p><strong>Start date:</strong> ${formatSubscriptionDate(stall.subscription_start)}</p>
            <p><strong>End date:</strong> ${formatSubscriptionDate(stall.subscription_end)}</p>
            <p><strong>Time remaining:</strong> ${getSubscriptionRemainingText(stall.subscription_end)}</p>
          </div>
        `;
      }).join("");
    }
  }


  const stallList =
    document.getElementById("stallList");


  if (data.length === 0) {

    stallList.textContent =
      "No stalls found.";

    return;
  }


  stallList.innerHTML = data.map(stall => {
    const subscriptionState = getSubscriptionStatusInfo(stall);
    const isExpired = subscriptionState.key === "expired";
    const action = stall.status === "suspended" ? "Activate" : "Suspend";
    const newStatus = stall.status === "suspended" ? "active" : "suspended";

    return `
      <div class="stall">
        <h3>${escapeHtml(stall.name)}</h3>
        <p><strong>Owner:</strong> ${escapeHtml(stall.owner_name || "Not added")}</p>
        <p><strong>Phone:</strong> ${escapeHtml(stall.phone || "Not added")}</p>
        <p><strong>Address:</strong> ${escapeHtml(stall.address || "Not added")}</p>
        <span class="status">${subscriptionState.label}</span>
        <br><br>
        <button type="button" onclick="window.location.href='stall.html?stall_id=${stall.id}'">Open Stall Dashboard</button>
        ${isExpired
          ? '<p><strong>Renewal required:</strong> Record a subscription payment to reactivate this stall.</p>'
          : `<button onclick="changeStallStatus('${stall.id}', '${newStatus}')">${action}</button>`}
      </div>
    `;
  }).join("");

  await loadSubscriptionPaymentStalls(data);
  if (preselectPaymentStallId) {
    const paymentSelect = document.getElementById("subscriptionPaymentStall");
    if (paymentSelect) {
      paymentSelect.value = preselectPaymentStallId;
      await loadSubscriptionPayments();
    }
  }
}


async function changeStallStatus(stallId, newStatus) {

  if (newStatus === "active") {
    const { data: selectedStall, error: lookupError } = await supabaseClient
      .from("stalls")
      .select("subscription_end")
      .eq("id", stallId)
      .maybeSingle();

    if (lookupError || !selectedStall) {
      alert("Could not verify this stall's subscription. Please refresh and try again.");
      return;
    }

    if (selectedStall.subscription_end &&
        selectedStall.subscription_end < getIndiaDateInputValue()) {
      alert("This subscription has expired. Record a renewal payment to reactivate the stall.");
      return;
    }
  }

  const { error } = await supabaseClient
    .from("stalls")
    .update({
      status: newStatus
    })
    .eq("id", stallId);


  if (error) {

    console.error(error);

    alert(
      "Unable to change stall status: " +
      error.message
    );

    return;
  }


  alert(
    "Stall status changed to " +
    newStatus
  );


  loadStalls();
}


async function saveStallBranding() {
  const button = document.getElementById("saveBrandingButton");
  const message = document.getElementById("brandingMessage");
  const nameInput = document.getElementById("brandingStallName");
  const fileInput = document.getElementById("brandingLogoFile");
  if (!button || !message || !nameInput || !fileInput) return;

  const registeredName = nameInput.value.trim();
  if (!registeredName) {
    message.textContent = "Please enter your registered stall name.";
    return;
  }
  if (registeredName.length > 100) {
    message.textContent = "Stall name must be 100 characters or fewer.";
    return;
  }

  const file = fileInput.files && fileInput.files[0];
  if (file) {
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      message.textContent = "Please choose a PNG, JPG or WEBP image.";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      message.textContent = "Logo must be 2 MB or smaller.";
      return;
    }
  }

  button.disabled = true;
  message.textContent = "Saving stall profile...";
  try {
    const context = await getCurrentStallContext();
    const stall = context.stall;
    const updates = { name: registeredName };

    if (file) {
      const extension = file.type === "image/png" ? "png" :
        file.type === "image/webp" ? "webp" : "jpg";
      const filePath = stall.id + "/" + Date.now() + "-logo." + extension;
      const { error: uploadError } = await supabaseClient.storage
        .from("stall-logos")
        .upload(filePath, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: false
        });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabaseClient.storage
        .from("stall-logos")
        .getPublicUrl(filePath);
      updates.logo_url = publicData.publicUrl;
    }

    const { data: savedStall, error: saveError } = await supabaseClient
      .from("stalls")
      .update(updates)
      .eq("id", stall.id)
      .select("id, name, logo_url, status, ordering_enabled")
      .single();
    if (saveError) throw saveError;

    document.getElementById("stallName").textContent = savedStall.name;
    nameInput.value = savedStall.name;
    const headerLogo = document.getElementById("stallLogo");
    const preview = document.getElementById("brandingLogoPreview");
    if (savedStall.logo_url) {
      if (headerLogo) { headerLogo.src = savedStall.logo_url; headerLogo.hidden = false; }
      if (preview) { preview.src = savedStall.logo_url; preview.hidden = false; }
    }
    fileInput.value = "";
    message.textContent = "Stall profile saved successfully.";
  } catch (error) {
    console.error("Could not save stall branding:", error);
    message.textContent = "Could not save stall profile: " + (error.message || "Please try again.");
  } finally {
    button.disabled = false;
  }
}

async function saveStallUpiSettings() {
  const button = document.getElementById("saveStallUpiButton"), message = document.getElementById("stallUpiMessage");
  const upiId = document.getElementById("stallUpiId")?.value.trim() || "";
  const accountName = document.getElementById("stallUpiAccountName")?.value.trim() || "";
  if (!button || !message) return;
  if (upiId && !/^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(upiId)) { message.textContent = "Enter a valid UPI ID, for example name@bank."; return; }
  if (accountName.length > 100) { message.textContent = "Account name must be 100 characters or fewer."; return; }
  button.disabled = true; message.textContent = "Saving UPI settings...";
  try {
    const stall = (await getCurrentStallContext()).stall;
    const { data, error } = await supabaseClient.from("stalls").update({ upi_id: upiId || null, upi_account_name: accountName || null }).eq("id", stall.id).select("id, upi_id, upi_account_name").single();
    if (error) throw error;
    message.textContent = data.upi_id ? "UPI settings saved. Customers can now choose UPI at checkout." : "UPI details cleared. Customers will only see Cash at the stall.";
  } catch (error) { console.error(error); message.textContent = "Could not save UPI settings: " + (error.message || "Please try again."); }
  finally { button.disabled = false; }
}

async function loadStallDashboard() {
  let stall;
  try {
    const context = await getCurrentStallContext();
    stall = context.stall;
  } catch (error) {
    console.error("Could not resolve signed-in stall:", error);
    const name = document.getElementById("stallName");
    if (name) name.textContent = "Stall access unavailable";
    return;
  }

  document.getElementById("stallName").textContent = stall.name;
  const upiIdInput = document.getElementById("stallUpiId");
  const upiNameInput = document.getElementById("stallUpiAccountName");
  if (upiIdInput) upiIdInput.value = stall.upi_id || "";
  if (upiNameInput) upiNameInput.value = stall.upi_account_name || "";
  const brandingName = document.getElementById("brandingStallName");
  if (brandingName) brandingName.value = stall.name || "";
  const stallLogo = document.getElementById("stallLogo");
  const brandingPreview = document.getElementById("brandingLogoPreview");
  if (stallLogo) { stallLogo.hidden = !stall.logo_url; if (stall.logo_url) stallLogo.src = stall.logo_url; }
  if (brandingPreview) { brandingPreview.hidden = !stall.logo_url; if (stall.logo_url) brandingPreview.src = stall.logo_url; }
  document.getElementById("stallStatus").textContent = stall.status;

  const { data: categories, error: categoryError } = await supabaseClient
    .from("menu_categories")
    .select("id, name, sort_order")
    .eq("stall_id", stall.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (categoryError) {
    console.error("Could not load categories:", categoryError);
    return;
  }

  const { data: menuItems, error: menuError } = await supabaseClient
    .from("menu_items")
    .select("id, name, description, price, is_available, category_id, image_url, sort_order")
    .eq("stall_id", stall.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (menuError) {
    console.error("Could not load menu items:", menuError);
    return;
  }

  document.getElementById("menuCount").textContent = menuItems.length;

  const menuList = document.getElementById("menuList");

  if (!menuItems || menuItems.length === 0) {
    menuList.innerHTML = "<p>No menu items added yet.</p>";
    return;
  }

  const categoryGroups = (categories || []).map(category => {
    const items = menuItems.filter(
      item => item.category_id === category.id
    );

    return `
      <section class="menu-category" data-menu-category-id="${category.id}">
        <h2>${escapeHtml(category.name)}</h2>
        ${items.map(item => `
          <div class="stall" id="menu-item-${item.id}">
            ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy" style="width:100%;max-width:220px;max-height:160px;object-fit:cover;border-radius:10px;">` : ""}
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.description || "No description")}</p>
            <p>Price: ₹${item.price}</p>
            <span class="status">
              ${item.is_available ? "Available" : "Unavailable"}
            </span>
            <br><br>
            <button onclick="editMenuItem('${item.id}')">Edit</button>
            <label style="display:inline-block;margin:6px 4px;">
              Change photo
              <input type="file" accept="image/png,image/jpeg,image/webp" onchange="changeMenuItemPhoto('${item.id}', this)" style="display:block;max-width:190px;">
            </label>
            <button onclick="toggleMenuItem('${item.id}')">
              ${item.is_available ? "Mark Unavailable" : "Mark Available"}
            </button>
            <button type="button" onclick="window.deleteMenuItem('${item.id}')">
              Delete
            </button>
          </div>
        `).join("")}
      </section>
    `;
  });

  const uncategorizedItems = menuItems.filter(
    item => !item.category_id ||
      !(categories || []).some(category => category.id === item.category_id)
  );

  if (uncategorizedItems.length > 0) {
    categoryGroups.push(`
      <section class="menu-category" data-menu-category-id="">
        <h2>Uncategorized</h2>
        ${uncategorizedItems.map(item => `
          <div class="stall" id="menu-item-${item.id}">
            ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy" style="width:100%;max-width:220px;max-height:160px;object-fit:cover;border-radius:10px;">` : ""}
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.description || "No description")}</p>
            <p>Price: ₹${item.price}</p>
            <span class="status">
              ${item.is_available ? "Available" : "Unavailable"}
            </span>
            <br><br>
            <button onclick="editMenuItem('${item.id}')">Edit</button>
            <label style="display:inline-block;margin:6px 4px;">
              Change photo
              <input type="file" accept="image/png,image/jpeg,image/webp" onchange="changeMenuItemPhoto('${item.id}', this)" style="display:block;max-width:190px;">
            </label>
            <button onclick="toggleMenuItem('${item.id}')">
              ${item.is_available ? "Mark Unavailable" : "Mark Available"}
            </button>
            <button type="button" onclick="window.deleteMenuItem('${item.id}')">
              Delete
            </button>
          </div>
        `).join("")}
      </section>
    `);
  }

  menuList.innerHTML = categoryGroups.join("");
  renderMenuItemOrderControls(menuItems, stall.id);
}


function openMenu() {
  const menuSection = document.getElementById("menuManagement");
  if (menuSection) {
    menuSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    alert("Menu Management section could not be found.");
  }
}



function getStallScopedUrl(page) {
  const stallId = currentStallId ||
    new URLSearchParams(window.location.search).get("stall_id");
  return page + (stallId ? "?stall_id=" + encodeURIComponent(stallId) : "");
}

function openOrders() {
  window.location.href = getStallScopedUrl("orders.html");
}
function openReports() {
  window.location.href = getStallScopedUrl("reports.html");
}
function openInventory() {
  window.location.href = getStallScopedUrl("inventory.html");
}


window.foodStallKnownOrderIds =
  window.foodStallKnownOrderIds || new Set();

window.foodStallNewOrderIds =
  window.foodStallNewOrderIds || new Set();

window.foodStallOrdersInitialized =
  window.foodStallOrdersInitialized || false;

window.foodStallOrdersLoadInProgress = false;


// Prevent overlapping refreshes
async function loadOrders() {
  if (window.foodStallOrdersLoadInProgress) return;

  window.foodStallOrdersLoadInProgress = true;

  try {
    await loadOrdersInternal();
  } catch (error) {
    console.error("Order loading failed:", error);
  } finally {
    window.foodStallOrdersLoadInProgress = false;
  }
}


async function loadOrdersInternal() {
  const message = document.getElementById("ordersMessage");
  const list = document.getElementById("ordersList");

  if (!message || !list) return;

  message.textContent = "Loading orders...";

  // Resolve the stall assigned to the signed-in account.
  let stall;
  try {
    stall = (await getCurrentStallContext()).stall;
  } catch (stallError) {
    console.error("Could not resolve signed-in stall:", stallError);
    message.textContent = "Could not load your assigned stall: " + stallError.message;
    return;
  }

  const stallId = stall.id;
  const heading = document.querySelector(".container > p.muted");
  if (heading) heading.textContent = stall.name + " — manage customer orders";

  // Load orders
  const { data: orders, error } = await supabaseClient
    .from("orders")
    .select(
      "*"
    )
    .eq("stall_id", stallId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load orders:", error);
    message.textContent = "Unable to load orders: " + error.message;
    return;
  }

  // Fetch customer instructions independently so they are never lost in the
  // main order payload or hidden by a stale/partial column selection.
  if (orders && orders.length) {
    const { data: instructionRows, error: instructionError } = await supabaseClient
      .from("orders")
      .select("id, special_instructions")
      .eq("stall_id", stallId)
      .in("id", orders.map(order => order.id));

    if (instructionError) {
      console.error("Could not load customer instructions:", instructionError);
    } else {
      const instructionByOrderId = new Map(
        (instructionRows || []).map(row => [row.id, row.special_instructions])
      );
      orders.forEach(order => {
        order.special_instructions = instructionByOrderId.get(order.id) ?? order.special_instructions ?? "";
      });
    }
  }

  if (!orders || orders.length === 0) {
    if (!window.foodStallOrdersInitialized) {
      window.foodStallKnownOrderIds = new Set();
      window.foodStallOrdersInitialized = true;
    }

    message.textContent = "No orders yet.";
    list.innerHTML = "";
    return;
  }

  // Load food items
  const orderIds = orders.map(order => order.id);

  const { data: orderItems, error: itemsError } = await supabaseClient
    .from("order_items")
    .select("id, order_id, menu_item_id, item_name, quantity, unit_price")
    .in("order_id", orderIds);

  if (itemsError) {
    console.error("Could not load order items:", itemsError);
    message.textContent =
      "Orders found, but food items could not load: " + itemsError.message;
    return;
  }

  // Detect genuinely new orders
  let newOrders = [];

  if (!window.foodStallOrdersInitialized) {
    // First load: register old orders without alerts
    window.foodStallKnownOrderIds = new Set(
      orders.map(order => order.id)
    );

    window.foodStallOrdersInitialized = true;

  } else {
    newOrders = orders.filter(
      order => !window.foodStallKnownOrderIds.has(order.id)
    );

    newOrders.forEach(order => {
      window.foodStallKnownOrderIds.add(order.id);
      window.foodStallNewOrderIds.add(order.id);
    });
  }

  // Alert for genuinely new orders
  if (newOrders.length > 0) {

    // Sound alert
    if (
      typeof orderSoundAlertsEnabled !== "undefined" &&
      orderSoundAlertsEnabled &&
      typeof playNewOrderSound === "function"
    ) {
      try {
        playNewOrderSound();
      } catch (soundError) {
        console.error("Order sound failed:", soundError);
      }
    }

    // Browser notifications
    if (
      typeof orderBrowserNotificationsEnabled !== "undefined" &&
      orderBrowserNotificationsEnabled &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      newOrders.forEach(order => {
        try {
          new Notification("New Breakfast Box Order!", {
            body: "New order received. Token: " +
              (order.token_number ?? "Not assigned"),
            tag: "breakfast-order-" + order.id
          });
        } catch (notificationError) {
          console.error("Notification failed:", notificationError);
        }
      });
    }
  }

  // Remember all existing orders
  orders.forEach(order => {
    window.foodStallKnownOrderIds.add(order.id);
  });

  // Group food items by order
  const itemsByOrder = {};

  (orderItems || []).forEach(item => {
    if (!itemsByOrder[item.order_id]) {
      itemsByOrder[item.order_id] = [];
    }

    itemsByOrder[item.order_id].push(item);
  });

  // Escape displayed text
  const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  message.textContent = orders.length + " order(s) found.";

  // Display orders
  list.innerHTML = orders.map(order => {
    const items = itemsByOrder[order.id] || [];

    const isNewOrder =
      window.foodStallNewOrderIds.has(order.id);

    const foodItemsHTML = items.length
      ? items.map(item => `
          <div style="padding:8px 0; border-bottom:1px solid #ddd;">
            <strong>${escapeHTML(item.item_name)}</strong>
            <p>
              Quantity: ${Number(item.quantity) || 0}
              × ₹${Number(item.unit_price) || 0}
            </p>
            <p>
              Item Total: ₹${
                (Number(item.quantity) || 0) *
                (Number(item.unit_price) || 0)
              }
            </p>
          </div>
        `).join("")
      : "<p>No food items found for this order.</p>";

    return `
      <div class="card"
        style="${
          isNewOrder
            ? "border:2px solid #16a34a; background:#f0fdf4;"
            : ""
        }">

        ${
          isNewOrder
            ? '<span style="display:inline-block;background:#16a34a;color:white;padding:5px 10px;border-radius:5px;font-weight:bold;">NEW ORDER</span>'
            : ""
        }

        <h3>Order Token: ${escapeHTML(order.token_number ?? "Not assigned")}</h3>

        <h4>Food Items</h4>
        ${foodItemsHTML}

        ${String(order.special_instructions || "").trim()
          ? `<div style="display:block!important;visibility:visible!important;margin:14px 0;padding:14px 16px;border:2px solid #fca5a5;border-left:7px solid #dc2626;border-radius:10px;background:#fff1f2;color:#991b1b;"><strong style="display:block;color:#991b1b;font-size:15px;font-weight:800;">⚠ CUSTOMER INSTRUCTIONS</strong><p style="display:block;margin:8px 0 0;white-space:pre-wrap;color:#991b1b;font-weight:800;font-size:15px;">${escapeHTML(String(order.special_instructions).trim())}</p></div>`
          : '<p style="margin:10px 0;color:#777;">No special instructions.</p>'}

        <hr>

        <p><strong>Order Status:</strong>
          ${escapeHTML(order.order_status || "Pending")}
        </p>

        <p><strong>Payment Status:</strong>
          ${escapeHTML(order.payment_status || "Unknown")}
        </p>

        <p><strong>Payment Method:</strong> ${escapeHTML(order.payment_method === "upi_manual" ? "UPI (manual verification)" : "Cash at the stall")}</p>
        ${order.upi_transaction_reference ? `<p><strong>UPI reference:</strong> ${escapeHTML(order.upi_transaction_reference)}</p>` : ""}

        <p><strong>Subtotal:</strong>
          ₹${Number(order.subtotal) || 0}
        </p>

        <p><strong>Total:</strong>
          ₹${Number(order.total_amount) || 0}
        </p>

        <p><strong>Placed:</strong>
          ${
            order.created_at
              ? new Date(order.created_at).toLocaleString()
              : "Unknown"
          }
        </p>

        <hr>

        <label for="status-${escapeHTML(order.id)}">
          Update Order Status:
        </label>

        <select id="status-${escapeHTML(order.id)}">
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="preparing">Preparing</option>
          <option value="ready">Ready</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <button onclick="updateOrderStatus('${escapeHTML(order.id)}')">
          Save Status
        </button>

      </div>
    `;
  }).join("");

  // Restore current order statuses
  orders.forEach(order => {
    const select = document.getElementById("status-" + order.id);

    if (select) {
      select.value = order.order_status || "pending";
    }
  });
}





async function loadOrders(options = {}) {
  const message = document.getElementById("ordersMessage");
  const list = document.getElementById("ordersList");

  if (!message || !list) return;
  if (!options.force && list.contains(document.activeElement)) return;
  if (window.foodStallOrderRefreshInProgress) return;
  window.foodStallOrderRefreshInProgress = true;
  const previousScrollY = window.scrollY;
  const visibleAnchor = [...list.querySelectorAll("[data-order-id]")].find(card => {
    const rect = card.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  const anchorOrderId = visibleAnchor?.dataset.orderId || null;
  const anchorTop = visibleAnchor?.getBoundingClientRect().top ?? null;

  const escapeHtml = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);

  const formatRupees = amount =>
    Number(amount ?? 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  const toLocalDateKey = date => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  };

  try {
    // Always load orders for the stall assigned to the signed-in account.
    const assignedStall = (await getCurrentStallContext()).stall;
    const heading = document.querySelector(".container > p.muted");
    if (heading) heading.textContent = assignedStall.name + " — manage customer orders";

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: orders, error } = await supabaseClient
      .from("orders")
      .select("id, token_number, order_status, payment_status, payment_method, upi_transaction_reference, subtotal, total_amount, special_instructions, created_at")
      .eq("stall_id", assignedStall.id)
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false });

    if (error) throw error;

       window.foodStallNewOrderIds = window.foodStallNewOrderIds || new Set();
       const currentOrderIds = new Set((orders || []).map(order => order.id));
       const newOrders = [];

       if (knownOrderIdsForAlerts === null) {
         knownOrderIdsForAlerts = currentOrderIds;
       } else {
         (orders || []).forEach(order => {
           if (!knownOrderIdsForAlerts.has(order.id)) {
             newOrders.push(order);
             knownOrderIdsForAlerts.add(order.id);
             window.foodStallNewOrderIds.add(order.id);
           }
         });
       }

       // Alert only today's pending orders. Never replay yesterday's backlog.
       // Remove anything no longer pending or outside today's local date.
       const todayAlertKey = toLocalDateKey(new Date());
       (orders || []).forEach(order => {
         const isPending = (order.order_status || "pending").toLowerCase() === "pending";
         const isToday = order.created_at &&
           toLocalDateKey(new Date(order.created_at)) === todayAlertKey;
         if (isPending && isToday && !acknowledgedOrderAlertIds.has(order.id)) {
           if (!pendingOrderAlerts.has(order.id)) pendingOrderAlerts.set(order.id, order);
         } else {
           stopPendingOrderAlert(order.id);
           window.foodStallNewOrderIds.delete(order.id);
         }
       });

       if (newOrders.length > 0) {
         newOrders.forEach(showNewOrderNotification);
       }
       if (orderSoundAlertsEnabled && pendingOrderAlerts.size > 0) {
         startOrderAlertLoop();
       } else if (pendingOrderAlerts.size === 0 && orderAlertRepeatTimer) {
         window.clearInterval(orderAlertRepeatTimer);
         orderAlertRepeatTimer = null;
         if ("speechSynthesis" in window) window.speechSynthesis.cancel();
       }
    // Daily summary always uses today's orders, regardless of the active list filters.
    const todayKey = toLocalDateKey(new Date());
    const todaysOrders = (orders || []).filter(order =>
      order.created_at && toLocalDateKey(new Date(order.created_at)) === todayKey
    );
    const pendingToday = todaysOrders.filter(order =>
      (order.order_status || "pending").toLowerCase() === "pending"
    ).length;
    const completedToday = todaysOrders.filter(order =>
      (order.order_status || "").toLowerCase() === "completed"
    );
    const completedSalesToday = completedToday.reduce(
      (sum, order) => sum + Number(order.total_amount ?? 0), 0
    );

    const summary = document.getElementById("dailyOrderSummary");
    if (summary) {
      summary.innerHTML = `
        <div class="summary-card">
          <span class="summary-label">Total Orders Today</span>
          <strong>${todaysOrders.length}</strong>
        </div>
        <div class="summary-card">
          <span class="summary-label">Pending Orders</span>
          <strong>${pendingToday}</strong>
        </div>
        <div class="summary-card">
          <span class="summary-label">Completed Orders</span>
          <strong>${completedToday.length}</strong>
        </div>
        <div class="summary-card">
          <span class="summary-label">Completed Order Value</span>
          <strong>₹${formatRupees(completedSalesToday)}</strong>
          <small>Completed orders only; may include pending payments</small>
        </div>
      `;
    }

    if (!orders || orders.length === 0) {
      message.textContent = "No orders yet.";
      return;
    }

    // Fetch the food items belonging to these orders.
    const orderIds = orders.map(order => order.id);

    const { data: orderItems, error: itemsError } = await supabaseClient
      .from("order_items")
      .select("order_id, item_name, quantity, unit_price, total_price")
      .in("order_id", orderIds);

    if (itemsError) {
      console.error("Could not load order items:", itemsError);
      message.textContent =
        "Orders loaded, but item details could not be loaded: " +
        itemsError.message;
    } else {
      message.textContent = orders.length + " order(s) found.";
    }

    // The active Orders page is today's live queue only.
    // Older orders are kept in the separate read-only Order History page.
    const statusFilter = document.getElementById("orderStatusFilter")?.value || "all";
    const visibleOrders = statusFilter === "all"
      ? todaysOrders
      : todaysOrders.filter(order => (order.order_status || "pending").toLowerCase() === statusFilter);

    message.textContent = visibleOrders.length + " fresh order(s) shown for today.";
    if (visibleOrders.length === 0) {
      list.innerHTML = '<p class="muted">No orders match these filters.</p>';
      return;
    }

    // Group food items by their order ID.
    const itemsByOrder = new Map();

    (orderItems || []).forEach(item => {
      if (!itemsByOrder.has(item.order_id)) {
        itemsByOrder.set(item.order_id, []);
      }

      itemsByOrder.get(item.order_id).push(item);
    });

    list.innerHTML = visibleOrders.map(order => {
      const items = itemsByOrder.get(order.id) || [];

      const itemList = items.length > 0
        ? `
          <ul class="order-items">
            ${items.map(item => `
              <li>
                <strong>${escapeHtml(item.item_name)}</strong>
                — Qty: ${escapeHtml(item.quantity)}
                — ₹${formatRupees(item.unit_price)} each
                — Total: ₹${formatRupees(item.total_price)}
              </li>
            `).join("")}
          </ul>
        `
        : "<p>No item details recorded.</p>";

      const customerInstructions = String(order.special_instructions || "").trim()
        ? `<div style="margin:12px 0;padding:14px 16px;border:2px solid #dc2626;border-left:7px solid #dc2626;border-radius:10px;background:#fff1f2;color:#991b1b;font-weight:700;"><div style="font-size:15px;margin-bottom:6px;">⚠ CUSTOMER INSTRUCTIONS</div><div style="white-space:pre-wrap;">${escapeHtml(order.special_instructions)}</div></div>`
        : "";

      const token = order.token_number == null
        ? "Not assigned"
        : String(order.token_number).padStart(4, "0");
      const isNewOrder = order.order_status === "pending" && window.foodStallNewOrderIds.has(order.id);

      return `
        <div class="card order-card ${isNewOrder ? "new-order-card" : ""}" data-order-id="${escapeHtml(order.id)}">
          ${isNewOrder ? '<span class="new-order-label">NEW ORDER</span>' : ""}
          <h3>Order Token: ${escapeHtml(token)}</h3>

          <p><strong>Food Items:</strong></p>
          ${itemList}
          ${customerInstructions}

          <p><strong>Order status:</strong> ${escapeHtml(order.order_status ?? "Pending")}</p>
          <p><strong>Payment status:</strong> ${escapeHtml(order.payment_status ?? "Unknown")}</p>
          <p><strong>Payment method:</strong> ${escapeHtml(order.payment_method === "upi_manual" ? "UPI (manual verification)" : "Cash at the stall")}</p>
          ${order.upi_transaction_reference ? `<p><strong>UPI reference:</strong> ${escapeHtml(order.upi_transaction_reference)}</p>` : ""}

          <div class="order-quick-actions">
            ${order.order_status === "pending" ? `<button class='quick-action primary' onclick='quickSetOrderStatus(&quot;${escapeHtml(order.id)}&quot;,&quot;accepted&quot;)'>Accept order</button>` : ""}
            ${order.order_status === "accepted" ? `<button class='quick-action primary' onclick='quickSetOrderStatus(&quot;${escapeHtml(order.id)}&quot;,&quot;preparing&quot;)'>Start preparing</button>` : ""}
            ${order.order_status === "preparing" ? `<button class='quick-action primary' onclick='quickSetOrderStatus(&quot;${escapeHtml(order.id)}&quot;,&quot;ready&quot;)'>Mark ready</button>` : ""}
            ${order.order_status === "ready" ? `<button class='quick-action primary' onclick='quickSetOrderStatus(&quot;${escapeHtml(order.id)}&quot;,&quot;completed&quot;)'>Complete order</button>` : ""}
            ${order.payment_status === "paid" ? `<button class='quick-action paid' onclick='quickSetPaymentStatus(&quot;${escapeHtml(order.id)}&quot;,&quot;pending&quot;)'>✓ Paid · Undo</button>` : `<button class='quick-action payment-due' onclick='quickSetPaymentStatus(&quot;${escapeHtml(order.id)}&quot;,&quot;paid&quot;)'>Mark payment received</button>`}
          </div>

          <p><strong>Subtotal:</strong> ₹${formatRupees(order.subtotal)}</p>
          <p><strong>Total:</strong> ₹${formatRupees(order.total_amount)}</p>
          <p><strong>Placed:</strong> ${escapeHtml(
            order.created_at
              ? new Date(order.created_at).toLocaleString()
              : "Unknown"
          )}</p>

          <details class="order-more-controls">
            <summary>More options</summary>
            <label for="status-${escapeHtml(order.id)}">
              Update order status:
            </label>

            <select id="status-${escapeHtml(order.id)}">
              <option value="pending" ${order.order_status === "pending" ? "selected" : ""}>Pending</option>
              <option value="accepted" ${order.order_status === "accepted" ? "selected" : ""}>Accepted</option>
              <option value="preparing" ${order.order_status === "preparing" ? "selected" : ""}>Preparing</option>
              <option value="ready" ${order.order_status === "ready" ? "selected" : ""}>Ready</option>
              <option value="completed" ${order.order_status === "completed" ? "selected" : ""}>Completed</option>
              <option value="cancelled" ${order.order_status === "cancelled" ? "selected" : ""}>Cancelled</option>
            </select>

            <button onclick="updateOrderStatus('${escapeHtml(order.id)}')">
              Save Status
            </button>
            </details>
        </div>
      `;
    }).join("");

  } catch (error) {
    console.error("Could not load orders:", error);
    message.textContent = "Unable to load orders: " + error.message;
  } finally {
    requestAnimationFrame(() => {
      if (anchorOrderId && anchorTop !== null) {
        const anchor = list.querySelector('[data-order-id="' + anchorOrderId + '"]');
        if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - anchorTop);
        else window.scrollTo(0, previousScrollY);
      } else window.scrollTo(0, previousScrollY);
      window.foodStallOrderRefreshInProgress = false;
    });
  }
}




function toggleCustomOrderDate() {
  const mode = document.getElementById("orderDateFilter")?.value;
  const dateInput = document.getElementById("customOrderDate");
  if (!dateInput) return;

  dateInput.style.display = mode === "custom" ? "inline-block" : "none";
  if (mode === "custom" && !dateInput.value) {
    const today = new Date();
    dateInput.value =
      today.getFullYear() + "-" +
      String(today.getMonth() + 1).padStart(2, "0") + "-" +
      String(today.getDate()).padStart(2, "0");
  }
}

async function quickSetOrderStatus(orderId, status) {
  const select = document.getElementById("status-" + orderId);
  if (!select) return;
  select.value = status;
  await updateOrderStatus(orderId);
}

async function quickSetPaymentStatus(orderId, status) {
  const message = document.getElementById("ordersMessage");
  if (!["pending", "paid"].includes(status) || !message) return;
  let stallId;
  try {
    stallId = (await getCurrentStallContext()).stall.id;
  } catch (error) {
    message.textContent = "Could not verify your stall: " + error.message;
    return;
  }
  message.textContent = status === "paid" ? "Recording payment..." : "Restoring pending payment status...";
  const { data, error } = await supabaseClient
    .from("orders")
    .update({ payment_status: status })
    .eq("id", orderId)
    .eq("stall_id", stallId)
    .select("id");
  if (error || !data || data.length === 0) {
    message.textContent = "Payment was not updated: " + (error?.message || "Please check permissions.");
    return;
  }
  message.textContent = status === "paid" ? "Payment marked as received." : "Payment status set to pending.";
  await loadOrders({ force: true });
}

async function updatePaymentStatus(orderId) {
  const select = document.getElementById("payment-status-" + orderId);
  const message = document.getElementById("ordersMessage");

  if (!select || !message) return;

  const newStatus = select.value;
  if (!["pending", "paid"].includes(newStatus)) {
    message.textContent = "Invalid payment status.";
    return;
  }

  message.textContent = "Updating payment status...";

  const { data, error } = await supabaseClient
    .from("orders")
    .update({ payment_status: newStatus })
    .eq("id", orderId)
    .select("id");

  if (error) {
    console.error("Could not update payment status:", error);
    message.textContent = "Unable to update payment status: " + error.message;
    return;
  }

  if (!data || data.length === 0) {
    message.textContent = "Payment status was not changed. Check your permissions.";
    await loadOrders();
    return;
  }

  message.textContent = "Payment status updated successfully!";
  await loadOrders({ force: true });
}


async function updateOrderStatus(orderId) {
  const select = document.getElementById("status-" + orderId);
  const message = document.getElementById("ordersMessage");

  if (!select || !message) return;

  const newStatus = select.value;
  let assignedStallId;
  try {
    assignedStallId = (await getCurrentStallContext()).stall.id;
  } catch (contextError) {
    message.textContent = "Could not verify your stall: " + contextError.message;
    return;
  }

  if (newStatus === "cancelled") {
  const confirmed = window.confirm(
    "Are you sure you want to cancel this order? Any recorded stock deductions will be restored."
  );

  if (!confirmed) {
    await loadOrders();
    return;
  }
}
  message.textContent = "Updating order status...";
console.log("Saving order:", orderId, "New status:", newStatus);
console.log("Current user:", (await supabaseClient.auth.getUser()).data.user?.id);
let result;

if (newStatus === "accepted") {
  result = await supabaseClient.rpc(
    "accept_order_and_deduct_stock",
    { p_order_id: orderId }
  );

} else if (newStatus === "cancelled") {
  result = await supabaseClient.rpc(
    "cancel_order_and_restore_stock",
    { p_order_id: orderId }
  );

} else {
  result = await supabaseClient
    .from("orders")
    .update({ order_status: newStatus })
    .eq("id", orderId)
    .eq("stall_id", assignedStallId)
    .select("id");
}

  if (result.error) {
    console.error("Could not update order:", result.error);
    message.textContent =
      "Unable to update order: " + result.error.message;
    return;
  }

  if (!result.data || result.data.length === 0) {
    message.textContent =
      "Order was not changed. Check your permissions or current order status.";
    await loadOrders();
    return;
  }

  message.textContent =
  newStatus === "accepted"
    ? "Order accepted and stock deduction completed!"
    : newStatus === "cancelled"
      ? result.data
      : "Order status updated successfully!";

  stopPendingOrderAlert(orderId);
  window.foodStallNewOrderIds.delete(orderId);
  await loadOrders({ force: true });
}



async function loadCategoriesForEditing() {
  const select = document.getElementById("editCategorySelect");
  if (!select) return;

  select.innerHTML = '<option value="">Select a category</option>';

  let stall;
  try {
    stall = (await getCurrentStallContext()).stall;
  } catch (stallError) {
    console.error("Could not resolve assigned stall:", stallError);
    return;
  }

  const { data: categories, error } = await supabaseClient
    .from("menu_categories")
    .select("id, name, sort_order")
    .eq("stall_id", stall.id)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Could not load categories:", error);
    return;
  }

  renderCategoryOrderControls(categories || [], stall.id);

  (categories || []).forEach(category => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  });

  select.onchange = () => {
    const selected = categories.find(
      category => category.id === select.value
    );

    document.getElementById("editCategoryName").value =
      selected ? selected.name : "";
  };
}

let categoryOrderDragState = null;

function renderCategoryOrderControls(categories, stallId) {
  const list = document.getElementById("categoryOrderList");
  if (!list) return;
  list.replaceChildren();

  if (!categories.length) {
    list.textContent = "Add a category first. Your customer page will follow this order.";
    return;
  }

  categories.forEach((category, index) => {
    const row = document.createElement("div");
    row.className = "category-order-row";
    row.dataset.categoryId = category.id;
    row.dataset.stallId = stallId;
    row.setAttribute("data-category-row", "");

    const handle = document.createElement("span");
    handle.className = "category-order-handle";
    handle.textContent = "☰ Drag";
    handle.draggable = true;
    handle.title = "Drag to rearrange " + category.name;
    handle.setAttribute("aria-label", "Drag to rearrange " + category.name);
    handle.addEventListener("dragstart", event => {
      categoryOrderDragState = {
        row,
        stallId,
        originalOrder: [...list.querySelectorAll("[data-category-row]")].map(item => item.dataset.categoryId)
      };
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", category.id);
    });
    handle.addEventListener("dragend", async () => {
      const dragState = categoryOrderDragState;
      categoryOrderDragState = null;
      row.classList.remove("dragging");
      list.querySelectorAll(".category-order-row").forEach(item => item.classList.remove("drop-target"));
      if (!dragState) return;
      const finalOrder = [...list.querySelectorAll("[data-category-row]")].map(item => item.dataset.categoryId);
      const changed = finalOrder.length === dragState.originalOrder.length &&
        finalOrder.some((id, index) => id !== dragState.originalOrder[index]);
      if (changed) await saveCategoryDisplayOrder(dragState.stallId);
    });

    const name = document.createElement("span");
    name.className = "category-order-name";
    name.textContent = category.name;

    const actions = document.createElement("span");
    actions.className = "category-order-actions";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.title = "Move " + category.name + " up";
    up.disabled = index === 0;
    up.addEventListener("click", async () => {
      const previous = row.previousElementSibling;
      if (previous) {
        list.insertBefore(row, previous);
        await saveCategoryDisplayOrder(stallId);
      }
    });
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.title = "Move " + category.name + " down";
    down.disabled = index === categories.length - 1;
    down.addEventListener("click", async () => {
      const next = row.nextElementSibling;
      if (next) {
        list.insertBefore(next, row);
        await saveCategoryDisplayOrder(stallId);
      }
    });
    actions.append(up, down);
    row.append(handle, name, actions);
    list.append(row);
  });

  if (!list.dataset.nativeDragBound) {
    list.addEventListener("dragover", event => {
      if (!categoryOrderDragState) return;
      // Accept drops anywhere in the list, including the gaps between rows.
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const targetRow = event.target.closest?.("[data-category-row]");
      if (!targetRow || targetRow === categoryOrderDragState.row || targetRow.parentElement !== list) return;
      const rect = targetRow.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      list.insertBefore(categoryOrderDragState.row, after ? targetRow.nextSibling : targetRow);
      list.querySelectorAll(".category-order-row").forEach(item => item.classList.remove("drop-target"));
      targetRow.classList.add("drop-target");
    });
    list.addEventListener("drop", event => {
      if (!categoryOrderDragState) return;
      event.preventDefault();
      // Save once in dragend, after the browser completes the drop.
    });
    list.dataset.nativeDragBound = "true";
  }
}

async function saveCategoryDisplayOrder(stallId) {
  const list = document.getElementById("categoryOrderList");
  const message = document.getElementById("categoryOrderMessage");
  if (!list || !message) return;

  const rows = [...list.querySelectorAll("[data-category-row]")];
  if (!rows.length) return;
  message.textContent = "Saving category order...";
  list.querySelectorAll("button").forEach(button => { button.disabled = true; });

  try {
    // Persist each final position once. A single pass is quicker and avoids the
    // previous temporary-negative-position round trip.
    for (let index = 0; index < rows.length; index++) {
      const { data, error } = await supabaseClient
        .from("menu_categories")
        .update({ sort_order: index + 1 })
        .eq("id", rows[index].dataset.categoryId)
        .eq("stall_id", stallId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("The category order could not be confirmed. Please retry.");
    }
    message.textContent = "✓ Category order saved.";
    // Refresh only the category editor data; don't reload the whole dashboard.
    await loadCategoriesForEditing();
  } catch (error) {
    console.error("Could not save category display order:", error);
    message.textContent = "Could not save the order: " + error.message;
    await loadCategoriesForEditing();
  } finally {
    list.querySelectorAll("button").forEach(button => { button.disabled = false; });
  }
}

let menuItemOrderDragState = null;

function renderMenuItemOrderControls(menuItems, stallId) {
  const sections = document.querySelectorAll("#menuList .menu-category");
  sections.forEach(section => {
    const rows = [...section.querySelectorAll('[id^="menu-item-"]')];
    if (!rows.length) return;

    const hint = document.createElement("p");
    hint.className = "menu-item-order-hint";
    hint.textContent = "Arrange dishes in this category. Drag ☰ or use the arrows; changes save automatically.";
    section.insertBefore(hint, rows[0]);

    rows.forEach((row, index) => {
      row.dataset.menuItemRow = "";
      const itemId = row.id.replace("menu-item-", "");
      const item = menuItems.find(entry => String(entry.id) === itemId);
      if (!item) return;

      const controls = document.createElement("div");
      controls.className = "menu-item-order-controls";

      const handle = document.createElement("span");
      handle.className = "menu-item-order-handle";
      handle.textContent = "☰ Drag";
      handle.draggable = true;
      handle.title = "Drag to rearrange " + item.name;
      handle.setAttribute("aria-label", "Drag to rearrange " + item.name);
      handle.addEventListener("dragstart", event => {
        menuItemOrderDragState = { row, section, stallId };
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", itemId);
      });
      handle.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        section.querySelectorAll(".menu-item-order-controls").forEach(control => control.classList.remove("drop-target"));
      });

      const name = document.createElement("span");
      name.className = "menu-item-order-label";
      name.textContent = "Reorder";

      const actions = document.createElement("span");
      actions.className = "menu-item-order-actions";
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "↑";
      up.title = "Move " + item.name + " up";
      up.disabled = index === 0;
      up.addEventListener("click", async () => {
        const previous = row.previousElementSibling;
        if (previous?.hasAttribute("data-menu-item-row")) {
          section.insertBefore(row, previous);
          await saveMenuItemDisplayOrder(stallId, section);
        }
      });
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "↓";
      down.title = "Move " + item.name + " down";
      down.disabled = index === rows.length - 1;
      down.addEventListener("click", async () => {
        const next = row.nextElementSibling;
        if (next?.hasAttribute("data-menu-item-row")) {
          section.insertBefore(next, row);
          await saveMenuItemDisplayOrder(stallId, section);
        }
      });
      actions.append(up, down);
      controls.append(handle, name, actions);
      row.insertBefore(controls, row.firstChild);
    });

    if (!section.dataset.nativeDragBound) {
      section.addEventListener("dragover", event => {
        if (!menuItemOrderDragState || menuItemOrderDragState.section !== section) return;
        const targetRow = event.target.closest?.("[data-menu-item-row]");
        if (!targetRow || targetRow === menuItemOrderDragState.row || targetRow.parentElement !== section) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = targetRow.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        section.insertBefore(menuItemOrderDragState.row, after ? targetRow.nextSibling : targetRow);
        section.querySelectorAll(".menu-item-order-controls").forEach(control => control.classList.remove("drop-target"));
        targetRow.querySelector(".menu-item-order-controls")?.classList.add("drop-target");
      });
      section.addEventListener("drop", async event => {
        if (!menuItemOrderDragState || menuItemOrderDragState.section !== section) return;
        event.preventDefault();
        const drag = menuItemOrderDragState;
        menuItemOrderDragState = null;
        section.querySelectorAll(".menu-item-order-controls").forEach(control => control.classList.remove("drop-target"));
        await saveMenuItemDisplayOrder(drag.stallId, section);
      });
      section.dataset.nativeDragBound = "true";
    }
  });
}

async function saveMenuItemDisplayOrder(stallId, section) {
  const message = document.getElementById("menuMessage");
  const rows = [...section.querySelectorAll("[data-menu-item-row]")];
  const categoryId = section.dataset.menuCategoryId || null;
  if (message) message.textContent = "Saving dish order...";
  section.querySelectorAll("button").forEach(button => { button.disabled = true; });

  try {
    // Temporary positions make the reorder safe even if a unique ordering
    // constraint is added later. Confirm every row update through RETURNING.
    for (let index = 0; index < rows.length; index++) {
      let query = supabaseClient
        .from("menu_items")
        .update({ sort_order: -(index + 1) })
        .eq("id", rows[index].id.replace("menu-item-", ""))
        .eq("stall_id", stallId);
      query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Your account cannot update this dish. Please sign in using the correct stall-owner account.");
    }
    for (let index = 0; index < rows.length; index++) {
      let query = supabaseClient
        .from("menu_items")
        .update({ sort_order: index + 1 })
        .eq("id", rows[index].id.replace("menu-item-", ""))
        .eq("stall_id", stallId);
      query = categoryId ? query.eq("category_id", categoryId) : query.is("category_id", null);
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("The final dish order could not be confirmed. Please retry.");
    }
    if (message) message.textContent = "✓ Dish order saved. Refresh the customer page to see the new order.";
    await loadStallDashboard();
  } catch (error) {
    console.error("Could not save menu item order:", error);
    if (message) message.textContent = "Could not save dish order: " + error.message;
    await loadStallDashboard();
  }
}

async function updateMenuCategory() {
  const select = document.getElementById("editCategorySelect");
  const nameInput = document.getElementById("editCategoryName");
  const message = document.getElementById("editCategoryMessage");

  const categoryId = select.value;
  const newName = nameInput.value.trim();

  if (!categoryId) {
    message.textContent = "Please select a category.";
    return;
  }

  if (!newName) {
    message.textContent = "Please enter a category name.";
    return;
  }

  message.textContent = "Saving category name...";

  const { error } = await supabaseClient
    .from("menu_categories")
    .update({ name: newName })
    .eq("id", categoryId);

  if (error) {
    console.error(error);
    message.textContent = "Unable to update category: " + error.message;
    return;
  }

  message.textContent = "Category name updated successfully!";

  await loadCategoriesForEditing();
  await loadMenuCategories();
  await loadStallDashboard();
}

async function deleteMenuCategory() {
  const select = document.getElementById("editCategorySelect");
  const message = document.getElementById("editCategoryMessage");

  const categoryId = select.value;

  if (!categoryId) {
    message.textContent = "Please select a category first.";
    return;
  }

  const accepted = confirm(
    "Are you sure you want to delete this category? " +
    "Categories containing menu items cannot be deleted."
  );

  if (!accepted) return;

  message.textContent = "Checking category...";

  const { data: items, error: itemsError } = await supabaseClient
    .from("menu_items")
    .select("id")
    .eq("category_id", categoryId)
    .limit(1);

  if (itemsError) {
    console.error(itemsError);
    message.textContent =
      "Could not check menu items: " + itemsError.message;
    return;
  }

  if (items && items.length > 0) {
    message.textContent =
      "This category contains menu items. Move those items to another category before deleting it.";
    return;
  }

  const { error } = await supabaseClient
    .from("menu_categories")
    .delete()
    .eq("id", categoryId);

  if (error) {
    console.error(error);
    message.textContent =
      "Unable to delete category: " + error.message;
    return;
  }

  message.textContent = "Category deleted successfully!";
  document.getElementById("editCategoryName").value = "";

  await loadCategoriesForEditing();
  await loadMenuCategories();
  await loadStallDashboard();
}

async function addMenuCategory() {
  const nameInput = document.getElementById("categoryName");
  const message = document.getElementById("categoryMessage");
  const categoryName = nameInput.value.trim();

  if (!categoryName) {
    message.textContent = "Please enter a category name.";
    return;
  }

  message.textContent = "Adding category...";

  let stallId;
  try {
    stallId = (await getCurrentStallContext()).stall.id;
  } catch (stallError) {
    message.textContent = "Could not load your assigned stall: " + stallError.message;
    return;
  }

  const { data: existingCategories, error: categoryOrderError } = await supabaseClient
    .from("menu_categories")
    .select("sort_order")
    .eq("stall_id", stallId);
  if (categoryOrderError) {
    message.textContent = "Could not prepare the new category position: " + categoryOrderError.message;
    return;
  }
  const nextSortOrder = (existingCategories || []).reduce(
    (highest, category) => Math.max(highest, Number(category.sort_order) || 0), 0
  ) + 1;

  const { error } = await supabaseClient
    .from("menu_categories")
    .insert({
      stall_id: stallId,
      name: categoryName,
      sort_order: nextSortOrder
    });

  if (error) {
    console.error("Could not add category:", error);
    message.textContent = "Unable to add category: " + error.message;
    return;
  }

  message.textContent = "Category added successfully!";
  nameInput.value = "";

  await loadCategoriesForEditing();
  await loadMenuCategories();
  await loadStallDashboard();
}

async function addMenuItem() {
  const name = document.getElementById("itemName").value.trim();
  const description = document.getElementById("itemDescription").value.trim();
  const price = Number(document.getElementById("itemPrice").value);
  const categoryId = document.getElementById("itemCategory").value;
  const isAvailable = document.getElementById("itemAvailable").checked;
  const photoInput = document.getElementById("itemPhotoFile");
  const photoFile = photoInput?.files?.[0] || null;
  const message = document.getElementById("menuMessage");

  if (!name) {
    message.textContent = "Please enter the food item name.";
    return;
  }
  if (!Number.isFinite(price) || price <= 0) {
    message.textContent = "Please enter a price greater than ₹0. Items priced at ₹0 are not shown on the customer ordering page.";
    return;
  }
  if (photoFile) {
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(photoFile.type)) {
      message.textContent = "Please choose a PNG, JPG or WEBP image.";
      return;
    }
    if (photoFile.size > 2 * 1024 * 1024) {
      message.textContent = "Food photo must be 2 MB or smaller.";
      return;
    }
  }

  message.textContent = "Adding menu item...";
  let stallId;
  try {
    stallId = (await getCurrentStallContext()).stall.id;
  } catch (stallError) {
    message.textContent = "Could not load your assigned stall: " + stallError.message;
    return;
  }

  let imageUrl = null;
  if (photoFile) {
    const extension = photoFile.type === "image/png" ? "png" :
      photoFile.type === "image/webp" ? "webp" : "jpg";
    const filePath = stallId + "/menu-items/" + crypto.randomUUID() + "." + extension;
    const { error: uploadError } = await supabaseClient.storage
      .from("stall-logos")
      .upload(filePath, photoFile, {
        cacheControl: "3600",
        contentType: photoFile.type,
        upsert: false
      });
    if (uploadError) {
      console.error("Menu photo upload failed:", uploadError);
      message.textContent = "Could not upload food photo: " + uploadError.message;
      return;
    }
    const { data: publicData } = supabaseClient.storage
      .from("stall-logos")
      .getPublicUrl(filePath);
    imageUrl = publicData.publicUrl;
  }

  let existingItemsQuery = supabaseClient
    .from("menu_items")
    .select("sort_order")
    .eq("stall_id", stallId);
  existingItemsQuery = categoryId
    ? existingItemsQuery.eq("category_id", categoryId)
    : existingItemsQuery.is("category_id", null);
  const { data: existingItems, error: orderLookupError } = await existingItemsQuery;
  if (orderLookupError) {
    message.textContent = "Could not prepare the new item's display position: " + orderLookupError.message;
    return;
  }
  const nextSortOrder = (existingItems || []).reduce(
    (highest, item) => Math.max(highest, Number(item.sort_order) || 0), 0
  ) + 1;

  if (categoryId) {
    const { data: selectedCategory, error: selectedCategoryError } = await supabaseClient
      .from("menu_categories")
      .select("id")
      .eq("id", categoryId)
      .eq("stall_id", stallId)
      .maybeSingle();
    if (selectedCategoryError) {
      message.textContent = "Could not verify the selected category: " + selectedCategoryError.message;
      return;
    }
    if (!selectedCategory) {
      message.textContent = "That category does not belong to this stall. Refresh the category list and try again.";
      await loadMenuCategories();
      return;
    }
  }

  const { data: insertedItem, error } = await supabaseClient
    .from("menu_items")
    .insert({
      stall_id: stallId,
      category_id: categoryId || null,
      sort_order: nextSortOrder,
      name,
      description: description || null,
      price,
      image_url: imageUrl,
      is_available: isAvailable
    })
    .select("id, name, category_id, is_available")
    .single();

  if (error) {
    console.error("Could not add menu item:", error);
    message.textContent = "Unable to add item: " + error.message;
    return;
  }
  if (!insertedItem) {
    message.textContent = "The item could not be confirmed as saved. Please check the menu before trying again.";
    return;
  }

  message.textContent = "Menu item added successfully!";
  document.getElementById("itemName").value = "";
  document.getElementById("itemDescription").value = "";
  document.getElementById("itemPrice").value = "";
  if (photoInput) photoInput.value = "";
  document.getElementById("itemAvailable").checked = true;
  await loadStallDashboard();
}
async function toggleMenuItem(itemId) {
  const message = document.getElementById("menuMessage");
  try {
    const stall = (await getCurrentStallContext()).stall;
    // Read the current database value so a stale dashboard button cannot reverse
    // the wrong state after another device has changed the item's availability.
    const { data: currentItem, error: readError } = await supabaseClient
      .from("menu_items")
      .select("id, name, is_available")
      .eq("id", itemId)
      .eq("stall_id", stall.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!currentItem) throw new Error("This menu item could not be found for the current stall. Refresh and try again.");

    const nextAvailability = !currentItem.is_available;
    const { data, error } = await supabaseClient
      .from("menu_items")
      .update({ is_available: nextAvailability })
      .eq("id", itemId)
      .eq("stall_id", stall.id)
      .select("id, name, is_available")
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("No item was updated. Check the signed-in account's menu permissions and try again.");

    if (message) {
      message.textContent = data.name + " is now " + (data.is_available ? "available" : "unavailable") + ".";
    }
    await loadStallDashboard();
  } catch (error) {
    console.error("Could not change menu item availability:", error);
    if (message) message.textContent = "Could not change availability: " + error.message;
    else alert("Unable to change item availability: " + error.message);
  }
}
async function editMenuItem(itemId) {
  const newName = prompt("Enter new item name:");
  if (newName === null) return;
  const newPrice = prompt("Enter new price:");
  if (newPrice === null) return;
  const price = Number(newPrice);
  if (!newName.trim() || !Number.isFinite(price) || price < 0) {
    alert("Please enter a valid name and price.");
    return;
  }
  const { error } = await supabaseClient
    .from("menu_items")
    .update({ name: newName.trim(), price })
    .eq("id", itemId);
  if (error) {
    console.error(error);
    alert("Unable to update item: " + error.message);
    return;
  }
  alert("Menu item updated successfully!");
  await loadStallDashboard();
}

async function changeMenuItemPhoto(itemId, input) {
  const file = input?.files?.[0];
  if (!file) return;
  const message = document.getElementById("menuMessage");
  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    if (message) message.textContent = "Choose a PNG, JPG or WEBP image.";
    input.value = "";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    if (message) message.textContent = "Food photo must be 2 MB or smaller.";
    input.value = "";
    return;
  }
  try {
    if (message) message.textContent = "Uploading replacement photo...";
    const stall = (await getCurrentStallContext()).stall;
    const extension = file.type === "image/png" ? "png" :
      file.type === "image/webp" ? "webp" : "jpg";
    const filePath = stall.id + "/menu-items/" + crypto.randomUUID() + "." + extension;
    const { error: uploadError } = await supabaseClient.storage
      .from("stall-logos")
      .upload(filePath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false
      });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabaseClient.storage
      .from("stall-logos")
      .getPublicUrl(filePath);
    const { error: updateError } = await supabaseClient
      .from("menu_items")
      .update({ image_url: publicData.publicUrl })
      .eq("id", itemId)
      .eq("stall_id", stall.id);
    if (updateError) throw updateError;
    if (message) message.textContent = "Menu photo updated successfully.";
    await loadStallDashboard();
  } catch (error) {
    console.error("Could not replace menu photo:", error);
    if (message) message.textContent = "Could not update photo: " + (error.message || "Please try again.");
  } finally {
    if (input) input.value = "";
  }
}

window.deleteMenuItem = async function deleteMenuItem(itemId) {
  const accepted = confirm(
    "Are you sure you want to delete this menu item?"
  );

  if (!accepted) {
    return;
  }

  const { error } = await supabaseClient
    .from("menu_items")
    .delete()
    .eq("id", itemId);

  if (error) {
    console.error(error);
    alert("Unable to delete item: " + error.message);
    return;
  }

  alert("Menu item deleted successfully!");
  await loadStallDashboard();
}

async function loadMenuCategories() {
  const categorySelect = document.getElementById("itemCategory");

  if (!categorySelect) return;

  categorySelect.innerHTML =
    '<option value="">Select a category</option>';

  let stall;
  try {
    stall = (await getCurrentStallContext()).stall;
  } catch (stallError) {
    console.error("Could not resolve assigned stall:", stallError);
    return;
  }

  const { data: categories, error } = await supabaseClient
    .from("menu_categories")
    .select("id, name")
    .eq("stall_id", stall.id)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Could not load categories:", error);
    categorySelect.innerHTML = '<option value="">Could not load categories — tap to retry</option>';
    return;
  }

  (categories || []).forEach(category => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    categorySelect.appendChild(option);
  });
}
// Daily Profit & Loss Report — read-only

async function loadDailyReport() {
  const message = document.getElementById("reportMessage");
  const dateInput = document.getElementById("reportDate");
  const periodInput = document.getElementById("reportPeriod");
  const rangeDisplay = document.getElementById("reportRange");
  const button = document.getElementById("loadReportButton");
  if (!message || !dateInput || !periodInput) return;

  const selectedDate = dateInput.value;
  const period = periodInput.value;
  if (!selectedDate) {
    message.textContent = "Please select a report date.";
    return;
  }

  const [year, month, day] = selectedDate.split("-").map(Number);
  const checkDate = new Date(year, month - 1, day);
  if (
    checkDate.getFullYear() !== year ||
    checkDate.getMonth() !== month - 1 ||
    checkDate.getDate() !== day
  ) {
    message.textContent = "Please select a valid calendar date.";
    return;
  }

  // Use local calendar boundaries, then convert order timestamps to UTC.
  const startDate = new Date(year, month - 1, day);
  if (period === "weekly") {
    const daysSinceMonday = (startDate.getDay() + 6) % 7;
    startDate.setDate(startDate.getDate() - daysSinceMonday);
  } else if (period === "monthly") {
    startDate.setDate(1);
  } else if (period !== "daily") {
    message.textContent = "Please select a valid report period.";
    return;
  }

  const endDate = new Date(startDate);
  if (period === "weekly") endDate.setDate(endDate.getDate() + 7);
  else if (period === "monthly") endDate.setMonth(endDate.getMonth() + 1);
  else endDate.setDate(endDate.getDate() + 1);

  const toDateInput = date => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  };
  const formatDate = date => {
    const [y, m, d] = toDateInput(date).split("-");
    return d + "-" + m + "-" + y.slice(-2);
  };
  let reportStartDate = startDate;
  let reportEndDate = endDate;
  let reportStartDateString = toDateInput(startDate);
  let reportEndDateString = toDateInput(new Date(endDate.getTime() - 86400000));
  const periodLabel = period === "weekly" ? "Weekly" : period === "monthly" ? "Monthly" : "Daily";

  message.textContent = "Loading report...";
  if (button) button.disabled = true;

  try {
    const stall = (await getCurrentStallContext()).stall;
    document.getElementById("reportStallName").textContent = stall.name;

    // Daily reports follow the stall's explicit login session, not midnight.
    // Weekly and monthly reports continue to use calendar boundaries.
    let sessionReport = false;
    let reportSession = null;
    if (period === "daily") {
      const { data: session, error: sessionError } = await supabaseClient
        .from("stall_token_sessions")
        .select("started_at, ended_at")
        .eq("stall_id", stall.id)
        .eq("session_date", selectedDate)
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (session) {
        reportSession = session;
        reportStartDate = new Date(session.started_at);
        reportEndDate = session.ended_at ? new Date(session.ended_at) : new Date();
        sessionReport = true;
      }
    }

    reportStartDateString = toDateInput(reportStartDate);
    reportEndDateString = toDateInput(reportEndDate);
    if (rangeDisplay) {
      if (sessionReport) {
        const startLabel = reportStartDate.toLocaleString("en-IN", {
          day: "2-digit", month: "2-digit", year: "2-digit",
          hour: "2-digit", minute: "2-digit"
        });
        const endLabel = reportEndDate.toLocaleString("en-IN", {
          day: "2-digit", month: "2-digit", year: "2-digit",
          hour: "2-digit", minute: "2-digit"
        });
        rangeDisplay.textContent = "Daily stall session: " + startLabel + " to " +
          (reportSession.ended_at ? endLabel : "now (continues until next-day login)");
      } else {
        rangeDisplay.textContent = periodLabel + " report: " +
          formatDate(startDate) + " to " + formatDate(new Date(endDate.getTime() - 86400000));
      }
    }

    const { data: orders, error: ordersError } = await supabaseClient
      .from("orders")
      .select("id, total_amount, subtotal, payment_status, order_status, created_at, stock_deducted_at")
      .eq("stall_id", stall.id)
      .gte("created_at", reportStartDate.toISOString())
      .lt("created_at", reportEndDate.toISOString());
    if (ordersError) throw ordersError;

    const validOrders = (orders || []).filter(order => order.order_status !== "cancelled");
    const paidSales = validOrders
      .filter(order => order.payment_status === "paid")
      .reduce((sum, order) => sum + Number(order.total_amount ?? order.subtotal ?? 0), 0);
    const pendingPayments = validOrders
      .filter(order => order.payment_status === "pending")
      .reduce((sum, order) => sum + Number(order.total_amount ?? order.subtotal ?? 0), 0);

    const { data: expenses, error: expensesError } = await supabaseClient
      .from("business_expenses")
      .select("amount")
      .eq("stall_id", stall.id)
      .gte("expense_date", reportStartDateString)
      .lte("expense_date", reportEndDateString);
    if (expensesError) throw expensesError;
    const businessExpenses = (expenses || []).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    // Keep the existing cautious recipe-cost estimate; do not change stock or recipe data.
    const eligibleOrders = validOrders.filter(order =>
      order.order_status === "completed" || Boolean(order.stock_deducted_at)
    );
    const completedOrdersWithoutDeduction = validOrders.filter(order =>
      order.order_status === "completed" && !order.stock_deducted_at
    ).length;
    let ingredientCost = 0;
    let ingredientCostDataIncomplete = false;

    if (eligibleOrders.length > 0) {
      const orderIds = eligibleOrders.map(order => order.id);
      const { data: orderItems, error: itemsError } = await supabaseClient
        .from("order_items")
        .select("order_id, menu_item_id, quantity")
        .in("order_id", orderIds);
      if (itemsError) throw itemsError;

      const menuItemIds = [...new Set((orderItems || []).map(item => item.menu_item_id).filter(Boolean))];
      if (menuItemIds.length === 0) {
        ingredientCostDataIncomplete = true;
      } else {
        const { data: recipeStatuses, error: recipeStatusError } = await supabaseClient
          .from("menu_items")
          .select("id, recipe_complete")
          .eq("stall_id", stall.id)
          .in("id", menuItemIds);
        if (recipeStatusError) throw recipeStatusError;
        const recipeStatusMap = new Map((recipeStatuses || []).map(item => [
          item.id, item.recipe_complete === true
        ]));
        if (menuItemIds.some(id => recipeStatusMap.get(id) !== true)) {
          ingredientCostDataIncomplete = true;
        }
      }

      if (menuItemIds.length > 0) {
        const { data: recipes, error: recipesError } = await supabaseClient
          .from("menu_item_ingredients")
          .select("menu_item_id, inventory_item_id, quantity_required")
          .eq("stall_id", stall.id)
          .in("menu_item_id", menuItemIds);
        if (recipesError) throw recipesError;

        const inventoryItemIds = [...new Set((recipes || []).map(recipe => recipe.inventory_item_id).filter(Boolean))];
        const { data: ingredients, error: ingredientsError } = inventoryItemIds.length
          ? await supabaseClient
              .from("inventory_items")
              .select("id, cost_per_unit")
              .eq("stall_id", stall.id)
              .in("id", inventoryItemIds)
          : { data: [], error: null };
        if (ingredientsError) throw ingredientsError;

        const inventoryItemsById = new Map((ingredients || []).map(item => [item.id, item]));
        const recipesByMenuItem = new Map();
        (recipes || []).forEach(recipe => {
          if (!recipesByMenuItem.has(recipe.menu_item_id)) recipesByMenuItem.set(recipe.menu_item_id, []);
          recipesByMenuItem.get(recipe.menu_item_id).push(recipe);
        });

        (orderItems || []).forEach(item => {
          const itemRecipes = recipesByMenuItem.get(item.menu_item_id) || [];
          if (!item.menu_item_id || itemRecipes.length === 0) {
            ingredientCostDataIncomplete = true;
            return;
          }
          const orderQuantity = Number(item.quantity);
          if (!Number.isFinite(orderQuantity) || orderQuantity <= 0) {
            ingredientCostDataIncomplete = true;
            return;
          }
          itemRecipes.forEach(recipe => {
            const ingredient = inventoryItemsById.get(recipe.inventory_item_id);
            const quantityRequired = Number(recipe.quantity_required);
            const rawCost = ingredient ? ingredient.cost_per_unit : null;
            const costPerUnit = rawCost === null || rawCost === undefined || rawCost === ""
              ? NaN : Number(rawCost);
            if (
              !ingredient ||
              !Number.isFinite(quantityRequired) || quantityRequired <= 0 ||
              !Number.isFinite(costPerUnit) || costPerUnit <= 0
            ) {
              ingredientCostDataIncomplete = true;
              return;
            }
            ingredientCost += orderQuantity * quantityRequired * costPerUnit;
          });
        });
      }
    }

    const estimatedProfit = paidSales - ingredientCost - businessExpenses;
    const formatRupees = amount => "₹" + amount.toLocaleString("en-IN", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    const totalOrdersElement = document.getElementById("totalOrders");
    if (totalOrdersElement) totalOrdersElement.textContent = String(validOrders.length);
    document.getElementById("paidSales").textContent = formatRupees(paidSales);
    document.getElementById("pendingPayments").textContent = formatRupees(pendingPayments);
    document.getElementById("businessExpenses").textContent = formatRupees(businessExpenses);
    document.getElementById("ingredientCost").textContent = formatRupees(ingredientCost);
    document.getElementById("estimatedProfit").textContent = formatRupees(estimatedProfit);

    const costCoverageMessage = eligibleOrders.length === 0
      ? " No completed or stock-deducted orders were found, so ingredient cost was not calculated; ₹0.00 does not mean ingredients cost nothing."
      : " Ingredient cost is a provisional estimate from recorded recipes. " +
        (completedOrdersWithoutDeduction > 0
          ? completedOrdersWithoutDeduction + " completed order(s) have no recorded stock-deduction timestamp; their recipe costs are included provisionally. "
          : "") +
        (ingredientCostDataIncomplete
          ? "Some menu items are not marked recipe-complete, or recipe records or ingredient prices are missing or invalid. Ingredient cost may be understated."
          : "");
    message.textContent = (sessionReport ? "Daily stall-session report loaded" : periodLabel + " report loaded") +
      " for " + formatDate(reportStartDate) + " to " + formatDate(reportEndDate) +
      ". Paid sales exclude pending payments and cancelled orders." +
      costCoverageMessage +
      " Estimated profit is provisional, not verified final profit.";
  } catch (error) {
    console.error("Unable to load report:", error);
    message.textContent = "Unable to load report: " + error.message;
  } finally {
    if (button) button.disabled = false;
  }
}
// Initialize the report page only when reports.html is open.
if (window.location.pathname.endsWith("reports.html")) {
  const reportDateInput = document.getElementById("reportDate");

  if (reportDateInput) {
    const today = new Date();

const localToday =
  String(today.getFullYear()) + "-" +
  String(today.getMonth() + 1).padStart(2, "0") + "-" +
  String(today.getDate()).padStart(2, "0");

reportDateInput.value = localToday;
const reportDateDisplay = document.getElementById("reportDateDisplay");

function updateReportDateDisplay() {
  if (!reportDateDisplay || !reportDateInput.value) return;

  const [year, month, day] = reportDateInput.value.split("-");
  reportDateDisplay.textContent =
    `${day}-${month}-${year.slice(-2)}`;
}

updateReportDateDisplay();

reportDateInput.addEventListener("change", updateReportDateDisplay);

    const reportPeriodInput = document.getElementById("reportPeriod");
    if (reportPeriodInput) reportPeriodInput.addEventListener("change", loadDailyReport);


    loadDailyReport();
  }
}

/* Initialize the stall dashboard for the signed-in user's assigned stall. */
if (window.location.pathname.endsWith("stall.html")) {
  (async function initializeStallDashboard() {
    const loginBox = document.getElementById("loginBox");
    const dashboard = document.getElementById("dashboard");
    if (!loginBox || !dashboard) return;

    // Password setup links must never be switched back to the login screen.
    if (isPasswordSetupUrl()) {
      showPasswordRecoveryForm();
      return;
    }

    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) {
      dashboard.style.display = "none";
      loginBox.style.display = "block";
      return;
    }

    try {
      await getCurrentStallContext();
      loginBox.style.display = "none";
      dashboard.style.display = "block";
      await loadStallDashboard();
      await loadMenuCategories();
      await loadCategoriesForEditing();

    } catch (contextError) {
      console.error("Stall dashboard access check failed:", contextError);
      dashboard.style.display = "none";
      loginBox.style.display = "block";
      const message = document.getElementById("loginMessage");
      if (message) message.textContent = contextError.message;
      await supabaseClient.auth.signOut();
    }
  })();
}


async function loadOrderChangeRequests() {
  const message = document.getElementById("changeRequestsMessage");
  const list = document.getElementById("changeRequestsList");
  if (!message || !list) return;

  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      message.textContent = "Sign in to view customer change requests.";
      return;
    }

    const response = await fetch(
      SUPABASE_URL + "/functions/v1/order-change-requests",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY,
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({ action: "list" })
      }
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load requests.");

    const requests = result.requests || [];
    if (!requests.length) {
      message.textContent = "No pending change requests.";
      list.replaceChildren();
      return;
    }

    const assignedStall = (await getCurrentStallContext()).stall;
    const ids = [...new Set(requests.flatMap(request =>
      (request.proposed_items || []).map(item => item.menu_item_id)
    ))];
    const { data: menuItems, error } = await supabaseClient
      .from("menu_items")
      .select("id,name,price")
      .eq("stall_id", assignedStall.id)
      .in("id", ids);
    if (error) throw error;
    const menuMap = new Map((menuItems || []).map(item => [item.id, item]));

    list.innerHTML = requests.map(request => {
      const order = Array.isArray(request.orders) ? request.orders[0] : request.orders;
      const rows = (request.proposed_items || []).map(item => {
        const menu = menuMap.get(item.menu_item_id);
        return "<li>" + escapeHtml(menu?.name || "Menu item") +
          " × " + Number(item.quantity) + "</li>";
      }).join("");
      return `
        <div class="card">
          <h3>Order Token: ${escapeHtml(order?.token_number ?? "Not assigned")}</h3>
          <p><strong>Requested:</strong> ${escapeHtml(new Date(request.requested_at).toLocaleString())}</p>
          <p><strong>Proposed items:</strong></p>
          <ul>${rows}</ul>
          <p><strong>Proposed total:</strong> ₹${Number(request.proposed_total).toFixed(2)}</p>
          <p><strong>Customer note:</strong> ${escapeHtml(request.customer_note || "None")}</p>
          <button onclick="decideOrderChangeRequest('${request.id}','approve')">Approve Change</button>
          <button onclick="decideOrderChangeRequest('${request.id}','reject')">Reject Request</button>
        </div>`;
    }).join("");
    message.textContent = requests.length + " pending change request(s).";
  } catch (error) {
    console.error("Change request loading failed:", error);
    message.textContent = "Unable to load change requests: " + error.message;
  }
}

async function decideOrderChangeRequest(requestId, decision) {
  if (!["approve", "reject"].includes(decision)) return;
  const promptText = decision === "approve"
    ? "Approve this change? The order items and total will be updated."
    : "Reject this customer change request?";
  if (!window.confirm(promptText)) return;

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    alert("Please sign in again.");
    return;
  }

  try {
    const response = await fetch(
      SUPABASE_URL + "/functions/v1/order-change-requests",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY,
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({ action: decision, request_id: requestId })
      }
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The request could not be processed.");
    const message = document.getElementById("changeRequestsMessage");
    if (message) message.textContent = decision === "approve"
      ? "Change approved. The order total has been updated."
      : "Change request rejected.";
    await loadOrderChangeRequests();
    if (typeof loadOrders === "function") await loadOrders();
  } catch (error) {
    alert(error.message);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

async function registerNewStall() {
  const fields = {
    stallName: document.getElementById("newStallName")?.value.trim() || "",
    ownerName: document.getElementById("newStallOwner")?.value.trim() || "",
    email: document.getElementById("newStallEmail")?.value.trim().toLowerCase() || "",
    phone: document.getElementById("newStallPhone")?.value.trim() || "",
    address: document.getElementById("newStallAddress")?.value.trim() || ""
  };
  const message = document.getElementById("stallRegistrationMessage");
  const button = document.getElementById("registerStallButton");

  if (!fields.stallName || !fields.ownerName || !fields.email || !fields.phone) {
    message.textContent = "Please complete the stall name, owner name, email and phone number.";
    return;
  }
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(fields.email)) {
    message.textContent = "Enter a valid owner email address.";
    return;
  }

  if (button) button.disabled = true;
  message.textContent = "Registering stall and sending the owner's invitation...";

  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) throw new Error("Please sign in again as Platform Admin.");

    const { data, error } = await supabaseClient.functions.invoke("register-stall", {
      body: fields,
      headers: { Authorization: `Bearer ${session.access_token}` }
    });

    if (error) throw new Error(data?.error || error.message || "Registration could not be completed.");
    if (!data?.success) throw new Error(data?.error || "Registration could not be completed.");

    message.textContent = "Stall registered successfully. An invitation has been sent to " + fields.email + ". Full app access and customer ordering are enabled during the 7-day free trial.";
    ["newStallName", "newStallOwner", "newStallEmail", "newStallPhone", "newStallAddress"].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = "";
    });
    await loadStalls();
  } catch (error) {
    console.error("Stall registration failed:", error);
    message.textContent = "Unable to register stall: " + error.message;
  } finally {
    if (button) button.disabled = false;
  }
}



async function convertStallApplication(applicationId) {
  const { data: application, error: lookupError } = await supabaseClient
    .from("stall_applications")
    .select("stall_name, selected_plan")
    .eq("id", applicationId)
    .maybeSingle();

  if (lookupError || !application || !["trial", "paid"].includes(application.selected_plan)) {
    alert("Could not verify this application's selected plan. Refresh and try again.");
    return;
  }

  const confirmation = application.selected_plan === "trial"
    ? "Create the 7-day trial stall and owner login for " + application.stall_name + "? Customer ordering will be enabled."
    : "Prepare a suspended stall and owner login for " + application.stall_name + "? Record the verified subscription payment before sending the owner's setup link.";
  if (!window.confirm(confirmation)) return;

  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) throw new Error("Please sign in again as Platform Admin.");

    const { data, error } = await supabaseClient.functions.invoke("convert-stall-application", {
      body: { application_id: applicationId },
      headers: { Authorization: "Bearer " + session.access_token }
    });
    if (error || !data?.success) throw new Error(data?.error || error?.message || "Could not create this stall.");

    alert(data.message);
    await loadStalls(data.stall_id);
    await loadStallApplications();
  } catch (error) {
    console.error("Application conversion failed:", error);
    alert("Unable to create stall: " + error.message);
    await loadStallApplications();
  }
}

async function generateOwnerSetupLink(applicationId) {
  const result = document.getElementById("ownerSetupLink-" + applicationId);
  if (!result) return;
  result.textContent = "Generating secure password setup link...";

  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) throw new Error("Please sign in again as Platform Admin.");

    const { data, error } = await supabaseClient.functions.invoke("generate-owner-setup-link", {
      body: { application_id: applicationId },
      headers: { Authorization: "Bearer " + session.access_token }
    });
    if (error || !data?.success || !data.action_link) {
      throw new Error(data?.error || error?.message || "Could not generate the setup link.");
    }

    const { data: application, error: applicationError } = await supabaseClient
      .from("stall_applications")
      .select("stall_name, owner_name, phone")
      .eq("id", applicationId)
      .maybeSingle();
    if (applicationError || !application) {
      throw new Error("Setup link was created, but applicant contact details could not be loaded. You can still copy the link.");
    }

    // Share a safe landing page, not the one-time Supabase link itself.
    // WhatsApp link-preview crawlers may open direct recovery links and consume their one-time token.
    const safeSetupUrl = APP_SITE_URL + "owner-setup.html#" + encodeURIComponent(data.action_link);
    const phone = String(application.phone || "").replace(/[^0-9]/g, "");
    const message = "Hello " + application.owner_name + ",\n\nWelcome to Food Stall Platform! Your " +
      application.stall_name + " stall account has been created with a 7-day free trial.\n\n" +
      "Please open this page, then tap Continue to securely set your password:\n" +
      safeSetupUrl + "\n\nThank you!";
    const whatsappUrl = phone
      ? "https://wa.me/" + phone + "?text=" + encodeURIComponent(message)
      : "";
    result.innerHTML = '<p>' + escapeHtml(data.message) + '</p>' +
      '<input type="text" readonly id="ownerSetupLinkInput-' + applicationId + '" value="' + escapeHtml(safeSetupUrl) + '" style="width:100%;box-sizing:border-box">' +
      '<button type="button" onclick="copyOwnerSetupLink(\'' + applicationId + '\')">Copy Safe Setup Link</button>' +
      (whatsappUrl
        ? ' <a class="button" href="' + escapeHtml(whatsappUrl) + '" target="_blank" rel="noopener">Open WhatsApp &amp; Send Message</a>'
        : '<p>Applicant phone number is missing. Copy the safe setup link and send it manually.</p>');
  } catch (error) {
    console.error("Owner setup link generation failed:", error);
    result.textContent = error.message;
  }
}

async function copyOwnerSetupLink(applicationId) {
  const input = document.getElementById("ownerSetupLinkInput-" + applicationId);
  if (!input?.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    alert("Owner setup link copied. Send it to the owner through WhatsApp.");
  } catch {
    window.prompt("Copy this secure owner setup link and send it through WhatsApp:", input.value);
  }
}

async function loadStallApplications() {
  const target = document.getElementById("stallApplicationsList");
  if (!target) return;
  target.textContent = "Loading applications...";
  const { data, error } = await supabaseClient
    .from("stall_applications")
    .select("id, stall_name, owner_name, email, phone, address, status, selected_plan, approval_token, converted_stall_id, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    target.textContent = "Unable to load applications: " + error.message;
    return;
  }
  if (!data || !data.length) {
    target.textContent = "No applications received yet.";
    return;
  }
  target.innerHTML = data.map(app => {
    const created = new Date(app.created_at).toLocaleString("en-IN");
    const status = app.status.charAt(0).toUpperCase() + app.status.slice(1);
    const plan = app.selected_plan === "trial" ? "7-day Free Trial selected" :
      app.selected_plan === "paid" ? "Paid Subscription selected" : "Awaiting subscription choice";
    const waText = encodeURIComponent("Hello " + app.owner_name + ", regarding your application for " + app.stall_name + " on Food Stall Platform.");
    const waPhone = String(app.phone || "").replace(/[^0-9]/g, "");
    const whatsapp = waPhone ? '<a href="https://wa.me/' + waPhone + '?text=' + waText + '" target="_blank" rel="noopener">Message on WhatsApp</a>' : "";
    const actions = app.status === "submitted"
      ? '<button type="button" onclick="decideStallApplication(\'' + app.id + '\', \'approved\')">Accept &amp; Create Link</button> <button type="button" onclick="decideStallApplication(\'' + app.id + '\', \'rejected\')">Reject</button>'
      : app.status === "approved" && app.approval_token
        ? '<p><strong>Acceptance link:</strong><br><a href="https://breakfastbox.github.io/food-stall-platform/choose-plan.html?token=' + encodeURIComponent(app.approval_token) + '" target="_blank" rel="noopener">Open subscription choice link</a></p><button type="button" onclick="copyApplicationLink(\'' + app.approval_token + '\')">Copy Link</button>' +
          (app.selected_plan ? '<p><strong>Subscription choice:</strong> ' + escapeHtml(plan) + '</p><button type="button" onclick="convertStallApplication(\'' + app.id + '\')">' +
            (app.selected_plan === "trial" ? 'Create Trial Stall &amp; Owner Login' : 'Prepare Paid Stall for Payment') +
            '</button>' : '')
        : app.status === "converted" && app.converted_stall_id
          ? '<p><strong>Stall account:</strong> Created</p>' +
            (app.selected_plan === "trial"
              ? '<p>7-day trial is active and customer ordering is enabled.</p>'
              : '<p>Paid stall is prepared but remains suspended until you record the verified subscription payment.</p>') +
            '<button type="button" onclick="generateOwnerSetupLink(\'' + app.id + '\')">Generate Owner Setup Link</button>' +
            '<div id="ownerSetupLink-' + app.id + '" class="owner-setup-link-result" aria-live="polite"></div>'
          : app.status === "approved" && app.selected_plan
            ? '<button type="button" onclick="convertStallApplication(\'' + app.id + '\')">' +
              (app.selected_plan === "trial" ? 'Create Trial Stall &amp; Owner Login' : 'Prepare Paid Stall for Payment') +
              '</button>'
            : "";
    return '<article class="stall" style="margin:12px 0"><h3>' + escapeHtml(app.stall_name) + '</h3>' +
      '<p><strong>Owner:</strong> ' + escapeHtml(app.owner_name) + '</p>' +
      '<p><strong>Email:</strong> ' + escapeHtml(app.email) + '</p>' +
      '<p><strong>WhatsApp:</strong> ' + escapeHtml(app.phone) + '</p>' +
      '<p><strong>Address:</strong> ' + escapeHtml(app.address || "Not provided") + '</p>' +
      '<p><strong>Received:</strong> ' + escapeHtml(created) + '</p>' +
      '<p><strong>Status:</strong> ' + escapeHtml(status) + '</p>' +
      '<p><strong>Subscription choice:</strong> ' + plan + '</p>' +
      whatsapp + actions + '</article>';
  }).join("");
}

async function decideStallApplication(applicationId, decision) {
  if (!["approved", "rejected"].includes(decision)) return;
  const confirmText = decision === "approved"
    ? "Accept this application and create a private subscription-choice link?"
    : "Reject this application?";
  if (!window.confirm(confirmText)) return;
  const token = decision === "approved" ? crypto.randomUUID() + crypto.randomUUID() : null;
  const update = { status: decision, decision_at: new Date().toISOString(), approval_token: token };
  const { error } = await supabaseClient.from("stall_applications").update(update).eq("id", applicationId).eq("status", "submitted");
  if (error) {
    alert("Could not update application: " + error.message);
    return;
  }
  await loadStallApplications();
}

async function copyApplicationLink(token) {
  const url = APP_SITE_URL + "choose-plan.html?token=" + encodeURIComponent(token);
  try {
    await navigator.clipboard.writeText(url);
    alert("Subscription-choice link copied. Send it to the accepted applicant on WhatsApp.");
  } catch {
    window.prompt("Copy this link and send it to the applicant on WhatsApp:", url);
  }
}


/* Restore the Platform Admin session when the dashboard is refreshed. */
if (window.location.pathname.endsWith("index.html") || window.location.pathname.endsWith("/")) {
  (async function initializeAdminDashboard() {
    const loginBox = document.getElementById("loginBox");
    const dashboard = document.getElementById("dashboard");
    if (!loginBox || !dashboard) return;

    if (isPasswordSetupUrl()) {
      showPasswordRecoveryForm();
      return;
    }

    const loginMessage = document.getElementById("loginMessage");
    try {
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) {
        dashboard.style.display = "none";
        loginBox.style.display = "block";
        return;
      }

      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      if (userError || !user) throw userError || new Error("Your session has expired. Please sign in again.");

      const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile || profile.role !== "admin") {
        throw new Error("This account does not have Platform Admin access.");
      }

      loginBox.style.display = "none";
      dashboard.style.display = "block";
      if (loginMessage) loginMessage.textContent = "";
      await loadStalls();
      await loadStallApplications();
    } catch (error) {
      console.error("Admin session restore failed:", error);
      dashboard.style.display = "none";
      loginBox.style.display = "block";
      if (loginMessage) {
        loginMessage.textContent = error.message || "Please sign in again.";
      }
      if (error.message && /session has expired|invalid.*token/i.test(error.message)) {
        await supabaseClient.auth.signOut();
      }
    }
  })();
}
