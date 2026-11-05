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
    .select("id, name, status, ordering_enabled, logo_url")
    .limit(1);

  if (profile.role === "admin") {
    stallQuery = stallQuery.eq("name", "Breakfast Box");
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

  const frequencies = [880, 660];
  const now = orderAlertAudioContext.currentTime;

  frequencies.forEach((frequency, index) => {
    const start = now + index * 0.22;
    const oscillator = orderAlertAudioContext.createOscillator();
    const gain = orderAlertAudioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);

    oscillator.connect(gain);
    gain.connect(orderAlertAudioContext.destination);

    oscillator.start(start);
    oscillator.stop(start + 0.19);
  });
}

async function enableOrderSoundAlerts() {
  const button = document.getElementById("enableOrderSoundButton");
  const status = document.getElementById("orderSoundStatus");

  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("Sound alerts are not supported by this browser.");
    }

    if (!orderAlertAudioContext) {
      orderAlertAudioContext = new AudioContextClass();
    }

    await orderAlertAudioContext.resume();

    orderSoundAlertsEnabled = true;
    playNewOrderSound();

    if (button) {
      button.textContent = "Sound Alerts Enabled";
      button.disabled = true;
    }

    if (status) {
      status.textContent = "Sound alerts are enabled.";
    }

  } catch (error) {
    console.error("Could not enable sound alerts:", error);

    if (status) {
      status.textContent = error.message;
    }
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
  ["subscriptionPaymentDate", "subscriptionPeriodStart", "subscriptionPeriodEnd"].forEach(id => {
    const input = document.getElementById(id);
    if (input && !input.value) input.value = today;
  });

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
        <button type="button" onclick="window.location.href='stall.html'">Open Stall Dashboard</button>
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
    .order("sort_order", { ascending: true });

  if (categoryError) {
    console.error("Could not load categories:", categoryError);
    return;
  }

  const { data: menuItems, error: menuError } = await supabaseClient
    .from("menu_items")
    .select("id, name, description, price, is_available, category_id")
    .eq("stall_id", stall.id)
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
      <section class="menu-category">
        <h2>${category.name}</h2>
        ${items.map(item => `
          <div class="stall" id="menu-item-${item.id}">
            <h3>${item.name}</h3>
            <p>${item.description || "No description"}</p>
            <p>Price: ₹${item.price}</p>
            <span class="status">
              ${item.is_available ? "Available" : "Unavailable"}
            </span>
            <br><br>
            <button onclick="editMenuItem('${item.id}')">Edit</button>
            <button onclick="toggleMenuItem('${item.id}', ${item.is_available})">
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
      <section class="menu-category">
        <h2>Uncategorized</h2>
        ${uncategorizedItems.map(item => `
          <div class="stall" id="menu-item-${item.id}">
            <h3>${item.name}</h3>
            <p>${item.description || "No description"}</p>
            <p>Price: ₹${item.price}</p>
            <span class="status">
              ${item.is_available ? "Available" : "Unavailable"}
            </span>
            <br><br>
            <button onclick="editMenuItem('${item.id}')">Edit</button>
            <button onclick="toggleMenuItem('${item.id}', ${item.is_available})">
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
}


function openMenu() {
  const menuSection = document.getElementById("menuManagement");
  if (menuSection) {
    menuSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    alert("Menu Management section could not be found.");
  }
}



function openOrders() {
  window.location.href = "orders.html";
}
function openReports() {
  window.location.href = "reports.html";
}
function openInventory() {
  window.location.href = "inventory.html";
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
      "id, token_number, order_status, payment_status, subtotal, total_amount, created_at"
    )
    .eq("stall_id", stallId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load orders:", error);
    message.textContent = "Unable to load orders: " + error.message;
    return;
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

        <hr>

        <p><strong>Order Status:</strong>
          ${escapeHTML(order.order_status || "Pending")}
        </p>

        <p><strong>Payment Status:</strong>
          ${escapeHTML(order.payment_status || "Unknown")}
        </p>

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





async function loadOrders() {
  const message = document.getElementById("ordersMessage");
  const list = document.getElementById("ordersList");

  if (!message || !list) return;

  message.textContent = "Loading orders...";
  list.innerHTML = "";

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

    const { data: orders, error } = await supabaseClient
      .from("orders")
      .select("id, token_number, order_status, payment_status, subtotal, total_amount, created_at")
      .eq("stall_id", assignedStall.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

       const currentOrderIds = new Set(
  (orders || []).map(order => order.id)
);

if (knownOrderIdsForAlerts === null) {
  knownOrderIdsForAlerts = currentOrderIds;
} else {
  const newOrders = [];

  (orders || []).forEach(order => {
    if (!knownOrderIdsForAlerts.has(order.id)) {
      newOrders.push(order);
      knownOrderIdsForAlerts.add(order.id);
    }
  });

  if (newOrders.length > 0) {
    playNewOrderSound();

    newOrders.forEach(order => {
      showNewOrderNotification(order);
    });
  }
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

    // Apply status and local-calendar date filters after processing new-order alerts.
    const statusFilter = document.getElementById("orderStatusFilter")?.value || "all";
    const dateMode = document.getElementById("orderDateFilter")?.value || "all";
    const customDate = document.getElementById("customOrderDate")?.value || "";

    const today = new Date();
    const selectedDate = new Date(today);
    if (dateMode === "yesterday") selectedDate.setDate(selectedDate.getDate() - 1);

    const targetDateKey = dateMode === "custom"
      ? customDate
      : dateMode === "today" || dateMode === "yesterday"
        ? toLocalDateKey(selectedDate)
        : null;

    let visibleOrders = statusFilter === "all"
      ? orders
      : orders.filter(order => (order.order_status || "pending") === statusFilter);

    if (targetDateKey) {
      visibleOrders = visibleOrders.filter(order =>
        order.created_at &&
        toLocalDateKey(new Date(order.created_at)) === targetDateKey
      );
    }

    const dateDescription = dateMode === "today"
      ? " today"
      : dateMode === "yesterday"
        ? " yesterday"
        : dateMode === "custom" && targetDateKey
          ? " on " + targetDateKey
          : "";

    message.textContent =
      visibleOrders.length + " of " + orders.length + " order(s) shown" + dateDescription + ".";

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

      const token = order.token_number == null
        ? "Not assigned"
        : String(order.token_number).padStart(4, "0");

      return `
        <div class="card">
          <h3>Order Token: ${escapeHtml(token)}</h3>

          <p><strong>Food Items:</strong></p>
          ${itemList}

          <p><strong>Order status:</strong> ${escapeHtml(order.order_status ?? "Pending")}</p>
          <p><strong>Payment status:</strong> ${escapeHtml(order.payment_status ?? "Unknown")}</p>

          <label for="payment-status-${escapeHtml(order.id)}">
            Update payment status:
          </label>
          <select id="payment-status-${escapeHtml(order.id)}">
            <option value="pending" ${order.payment_status === "pending" ? "selected" : ""}>Pending</option>
            <option value="paid" ${order.payment_status === "paid" ? "selected" : ""}>Paid</option>
          </select>
          <button onclick="updatePaymentStatus('${escapeHtml(order.id)}')">
            Save Payment Status
          </button>

          <p><strong>Subtotal:</strong> ₹${formatRupees(order.subtotal)}</p>
          <p><strong>Total:</strong> ₹${formatRupees(order.total_amount)}</p>
          <p><strong>Placed:</strong> ${escapeHtml(
            order.created_at
              ? new Date(order.created_at).toLocaleString()
              : "Unknown"
          )}</p>

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
        </div>
      `;
    }).join("");

  } catch (error) {
    console.error("Could not load orders:", error);
    message.textContent = "Unable to load orders: " + error.message;
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

async function updatePaymentStatus(orderId) {
  const select = document.getElementById("payment-status-" + orderId);
  const message = document.getElementById("ordersMessage");

  if (!select || !message) return;

  const newStatus = select.value;
  if (!["pending", "paid"].includes(newStatus)) {
    message.textContent = "Invalid payment status.";
    return;
  }

  if (newStatus === "paid") {
    const confirmed = window.confirm(
      "This will count the order total as collected sales in Reports. For a designated test order only, you may temporarily set it to Paid and then restore Pending immediately after testing. Continue?"
    );
    if (!confirmed) {
      await loadOrders();
      return;
    }
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
  await loadOrders();
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

  await loadOrders();
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
    .select("id, name")
    .eq("stall_id", stall.id)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Could not load categories:", error);
    return;
  }

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

  const { error } = await supabaseClient
    .from("menu_categories")
    .insert({
      stall_id: stallId,
      name: categoryName
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

  const name =
    document.getElementById("itemName").value.trim();

  const description =
    document.getElementById("itemDescription").value.trim();

  const price =
    Number(document.getElementById("itemPrice").value);

  const imageUrl =
    document.getElementById("itemImage").value.trim();
const categoryId =
  document.getElementById("itemCategory").value;
  const isAvailable =
    document.getElementById("itemAvailable").checked;

  const message =
    document.getElementById("menuMessage");


  if (!name) {
    message.textContent = "Please enter the food item name.";
    return;
  }


  if (price < 0 || isNaN(price)) {
    message.textContent = "Please enter a valid price.";
    return;
  }


  message.textContent = "Adding menu item...";


  let stallId;
  try {
    stallId = (await getCurrentStallContext()).stall.id;
  } catch (stallError) {
    message.textContent = "Could not load your assigned stall: " + stallError.message;
    return;
  }


  const { error } = await supabaseClient
    .from("menu_items")
   
.insert({
  stall_id: stallId,
  category_id: categoryId || null,
  name: name,
  description: description || null,
  price: price,
  image_url: imageUrl || null,
  is_available: isAvailable
});

  if (error) {

    console.error(error);

    message.textContent =
      "Unable to add item: " + error.message;

    return;
  }


  message.textContent =
    "Menu item added successfully!";


  document.getElementById("itemName").value = "";
  document.getElementById("itemDescription").value = "";
  document.getElementById("itemPrice").value = "";
  document.getElementById("itemImage").value = "";
  document.getElementById("itemAvailable").checked = true;


  loadStallDashboard();
}
async function toggleMenuItem(itemId, currentStatus) {

  const { error } = await supabaseClient
    .from("menu_items")
    .update({
      is_available: !currentStatus
    })
    .eq("id", itemId);


  if (error) {

    console.error(error);

    alert(
      "Unable to change item availability: " +
      error.message
    );

    return;
  }


  loadStallDashboard();
}
async function editMenuItem(itemId) {

  const newName =
    prompt("Enter new item name:");

  if (newName === null) {
    return;
  }


  const newPrice =
    prompt("Enter new price:");

  if (newPrice === null) {
    return;
  }


  const price = Number(newPrice);


  if (!newName.trim() || isNaN(price) || price < 0) {

    alert(
      "Please enter a valid name and price."
    );

    return;
  }


  const { error } = await supabaseClient
    .from("menu_items")
    .update({
      name: newName.trim(),
      price: price
    })
    .eq("id", itemId);


  if (error) {

    console.error(error);

    alert(
      "Unable to update item: " +
      error.message
    );

    return;
  }


  alert("Menu item updated successfully!");

  loadStallDashboard();
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
  const startDateString = toDateInput(startDate);
  const endDateString = toDateInput(new Date(endDate.getTime() - 86400000));
  const periodLabel = period === "weekly" ? "Weekly" : period === "monthly" ? "Monthly" : "Daily";
  if (rangeDisplay) {
    rangeDisplay.textContent = periodLabel + " report: " +
      formatDate(startDate) + " to " + formatDate(new Date(endDate.getTime() - 86400000));
  }

  message.textContent = "Loading report...";
  if (button) button.disabled = true;

  try {
    const stall = (await getCurrentStallContext()).stall;
    document.getElementById("reportStallName").textContent = stall.name;

    const { data: orders, error: ordersError } = await supabaseClient
      .from("orders")
      .select("id, total_amount, subtotal, payment_status, order_status, created_at, stock_deducted_at")
      .eq("stall_id", stall.id)
      .gte("created_at", startDate.toISOString())
      .lt("created_at", endDate.toISOString());
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
      .gte("expense_date", startDateString)
      .lte("expense_date", endDateString);
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
    message.textContent = periodLabel + " report loaded for " +
      formatDate(startDate) + " to " + formatDate(new Date(endDate.getTime() - 86400000)) +
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

    const phone = String(application.phone || "").replace(/[^0-9]/g, "");
    const message = "Hello " + application.owner_name + ",\n\nWelcome to Food Stall Platform! Your " +
      application.stall_name + " stall account has been created with a 7-day free trial.\n\n" +
      "Please open this secure link to set your password and access your owner dashboard:\n" +
      data.action_link + "\n\nThank you!";
    const whatsappUrl = phone
      ? "https://wa.me/" + phone + "?text=" + encodeURIComponent(message)
      : "";
    result.innerHTML = '<p>' + escapeHtml(data.message) + '</p>' +
      '<input type="text" readonly id="ownerSetupLinkInput-' + applicationId + '" value="' + escapeHtml(data.action_link) + '" style="width:100%;box-sizing:border-box">' +
      '<button type="button" onclick="copyOwnerSetupLink(\'' + applicationId + '\')">Copy Setup Link</button>' +
      (whatsappUrl
        ? ' <a class="button" href="' + escapeHtml(whatsappUrl) + '" target="_blank" rel="noopener">Open WhatsApp &amp; Send Message</a>'
        : '<p>Applicant phone number is missing. Copy the setup link and send it manually.</p>');
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
