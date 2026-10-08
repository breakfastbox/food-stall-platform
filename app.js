const SUPABASE_URL = "https://anlgfcltudysjnsipsmd.supabase.co";

const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x6V-O5rj20gGsoJSlbTsBw_kVuICTBv";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);


async function loginAdmin() {

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const loginMessage = document.getElementById("loginMessage");

  loginMessage.textContent = "Logging in...";

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    loginMessage.textContent = "Login failed: " + error.message;
    return;
  }

  document.getElementById("loginBox").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  loginMessage.textContent = "";

  loadStalls();
}


async function logoutAdmin() {

  await supabaseClient.auth.signOut();

  document.getElementById("dashboard").style.display = "none";
  document.getElementById("loginBox").style.display = "block";

}


async function loadStalls() {

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

    return;
  }


  document.getElementById("totalStalls").textContent = data.length;

  document.getElementById("activeStalls").textContent =
    data.filter(stall => stall.status === "active").length;

  document.getElementById("trialStalls").textContent =
    data.filter(stall => stall.status === "trial").length;

  document.getElementById("suspendedStalls").textContent =
    data.filter(stall => stall.status === "suspended").length;


  const stallList = document.getElementById("stallList");


  if (data.length === 0) {

    stallList.textContent = "No stalls found.";

    return;
  }


  stallList.innerHTML = data.map(stall => `

    <div class="stall">

      <h3>${stall.name}</h3>

      <p>
        <strong>Owner:</strong>
        ${stall.owner_name || "Not added"}
      </p>

      <p>
        <strong>Phone:</strong>
        ${stall.phone || "Not added"}
      </p>

      <p>
        <strong>Address:</strong>
        ${stall.address || "Not added"}
      </p>

      <span class="status">
        ${stall.status}
      </span>

    </div>

  `).join("");

}
