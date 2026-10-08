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


  document.getElementById("totalStalls").textContent =
    data.length;

  document.getElementById("activeStalls").textContent =
    data.filter(stall => stall.status === "active").length;

  document.getElementById("trialStalls").textContent =
    data.filter(stall => stall.status === "trial").length;

  document.getElementById("suspendedStalls").textContent =
    data.filter(stall => stall.status === "suspended").length;


  const stallList =
    document.getElementById("stallList");


  if (data.length === 0) {

    stallList.textContent =
      "No stalls found.";

    return;
  }


  stallList.innerHTML = data.map(stall => {

    const action =
      stall.status === "suspended"
        ? "Activate"
        : "Suspend";


    const newStatus =
      stall.status === "suspended"
        ? "active"
        : "suspended";


    return `

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

        <br><br>

        <button
          onclick="changeStallStatus('${stall.id}', '${newStatus}')"
        >
          ${action}
        </button>

      </div>

    `;

  }).join("");
}


async function changeStallStatus(stallId, newStatus) {

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
async function loadStallDashboard() {

  const { data: stalls, error } = await supabaseClient
    .from("stalls")
    .select("id, name, status")
    .eq("name", "Breakfast Box")
    .limit(1);

  if (error) {
    console.error(error);
    return;
  }

  if (!stalls || stalls.length === 0) {
    document.getElementById("stallName").textContent =
      "Stall not found";
    return;
  }

  const stall = stalls[0];

  document.getElementById("stallName").textContent =
    stall.name;

  document.getElementById("stallStatus").textContent =
    stall.status;


  const { data: menuItems, error: menuError } =
    await supabaseClient
      .from("menu_items")
      .select("id, name, price, is_available")
      .eq("stall_id", stall.id)
      .order("created_at", { ascending: true });


  if (menuError) {
    console.error(menuError);
    return;
  }


  document.getElementById("menuCount").textContent =
    menuItems.length;


  const menuList =
    document.getElementById("menuList");


  if (menuItems.length === 0) {

    menuList.innerHTML =
      "<p>No menu items added yet.</p>";

    return;
  }


  menuList.innerHTML = menuItems.map(item => `

    <div class="stall">

      <h3>${item.name}</h3>

      <p>
        Price: ₹${item.price}
      </p>

      <span class="status">
        ${item.is_available ? "Available" : "Unavailable"}
      </span>

    </div>

  `).join("");
}


function openMenu() {
  alert("Menu Management is coming next.");
}


function openOrders() {
  alert("Order Management is coming next.");
}


function openReports() {
  alert("Reports are coming next.");
}


function openInventory() {
  alert("Inventory Management is coming next.");
}
if (window.location.pathname.endsWith("stall.html")) {
  loadStallDashboard();
}
