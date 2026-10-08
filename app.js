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

    <div class="stall" id="menu-item-${item.id}">

      <h3>${item.name}</h3>

      <p>
        ${item.description || "No description"}
      </p>

      <p>
        Price: ₹${item.price}
      </p>

      <span class="status">
        ${item.is_available ? "Available" : "Unavailable"}
      </span>

      <br><br>

      <button
        onclick="editMenuItem('${item.id}')"
      >
        Edit
      </button>

      <button
        onclick="toggleMenuItem('${item.id}', ${item.is_available})"
      >
        ${item.is_available ? "Mark Unavailable" : "Mark Available"}
      </button>
<button
  onclick="deleteMenuItem('${item.id}', '${item.name.replace(/'/g, "\\'")}')"
>
  Delete
</button>
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
async function addMenuCategory() {

  const categoryName = document.getElementById("categoryName").value.trim();
  const message = document.getElementById("categoryMessage");

  if (!categoryName) {
    message.textContent = "Please enter a category name.";
    return;
  }

  message.textContent = "Adding category...";

  // Find Breakfast Box stall
  const { data: stall, error: stallError } = await supabaseClient
    .from("stalls")
    .select("id")
    .eq("name", "Breakfast Box")
    .single();

  if (stallError) {
    console.error(stallError);
    message.textContent = "Could not find the stall.";
    return;
  }

  // Get the next sort order
  const { data: lastCategory } = await supabaseClient
    .from("menu_categories")
    .select("sort_order")
    .eq("stall_id", stall.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSortOrder = lastCategory
    ? lastCategory.sort_order + 1
    : 1;

  // Insert category
  const { error } = await supabaseClient
    .from("menu_categories")
    .insert([
      {
        stall_id: stall.id,
        name: categoryName,
        sort_order: nextSortOrder
      }
    ]);

  if (error) {
    console.error(error);
    message.textContent = "Error adding category.";
    return;
  }

  message.textContent = "Category added successfully!";

  document.getElementById("categoryName").value = "";
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


  const { data: stalls, error: stallError } =
    await supabaseClient
      .from("stalls")
      .select("id")
      .eq("name", "Breakfast Box")
      .limit(1);


  if (stallError || !stalls || stalls.length === 0) {

    message.textContent =
      "Breakfast Box stall could not be found.";

    return;
  }


  const stallId = stalls[0].id;


  const { error } = await supabaseClient
    .from("menu_items")
    .insert({
      stall_id: stallId,
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
async function deleteMenuItem(itemId, itemName) {

  const confirmed = confirm(
    "Are you sure you want to delete " +
    itemName +
    "?"
  );


  if (!confirmed) {
    return;
  }


  const { error } = await supabaseClient
    .from("menu_items")
    .delete()
    .eq("id", itemId);


  if (error) {

    console.error(error);

    alert(
      "Unable to delete item: " +
      error.message
    );

    return;
  }


  alert("Menu item deleted successfully!");

  loadStallDashboard();
}
