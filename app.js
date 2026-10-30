const SUPABASE_URL = "https://anlgfcltudysjnsipsmd.supabase.co";

const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x6V-O5rj20gGsoJSlbTsBw_kVuICTBv";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

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
    await supabaseClient.auth.signOut();
    loginMessage.textContent =
      error.message || "Could not resume ordering. Please try again.";
    return;
  }

  document.getElementById("loginBox").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  loginMessage.textContent = "";

  loadStalls();

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

  if (error || !stalls || stalls.length === 0) {
    console.error(error || "Breakfast Box stall not found");
    document.getElementById("stallName").textContent = "Stall not found";
    return;
  }

  const stall = stalls[0];

  document.getElementById("stallName").textContent = stall.name;
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
            <button onclick="deleteMenuItem('${item.id}', ${JSON.stringify(item.name).replace(/</g, "\\u003c")})">
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
            <button onclick="deleteMenuItem('${item.id}', ${JSON.stringify(item.name).replace(/</g, "\\u003c")})">
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
  alert("Menu Management is coming next.");
}



function openOrders() {
  window.location.href = "orders.html";
}
function openReports() {
  window.location.href = "reports.html";
}
async function loadOrders() {
  const message = document.getElementById("ordersMessage");
  const list = document.getElementById("ordersList");

  if (!message || !list) return;

  message.textContent = "Loading orders...";
  list.innerHTML = "";

  const { data: stalls, error: stallError } = await supabaseClient
    .from("stalls")
    .select("id")
    .eq("name", "Breakfast Box")
    .limit(1);

  if (stallError || !stalls || stalls.length === 0) {
    console.error("Could not find stall:", stallError);
    message.textContent = "Could not load the Breakfast Box stall.";
    return;
  }

  const { data: orders, error } = await supabaseClient
    .from("orders")
    .select(
      "id, token_number, order_status, payment_status, subtotal, total_amount, created_at"
    )
    .eq("stall_id", stalls[0].id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load orders:", error);
    message.textContent = "Unable to load orders: " + error.message;
    return;
  }

  if (!orders || orders.length === 0) {
    message.textContent = "No orders yet.";
    return;
  }

  message.textContent = orders.length + " order(s) found.";

  list.innerHTML = orders.map(order => `
    <div class="card">
      <h3>Order Token: ${order.token_number ?? "Not assigned"}</h3>
      <p><strong>Order status:</strong> ${order.order_status ?? "Pending"}</p>
      <p><strong>Payment status:</strong> ${order.payment_status ?? "Unknown"}</p>
      <p><strong>Subtotal:</strong> ₹${order.subtotal ?? 0}</p>
      <p><strong>Total:</strong> ₹${order.total_amount ?? 0}</p>
      <p><strong>Placed:</strong> ${
        order.created_at
          ? new Date(order.created_at).toLocaleString()
          : "Unknown"
      }</p>

      <label for="status-${order.id}">Update order status:</label>
      <select id="status-${order.id}">
        <option value="pending">Pending</option>
        <option value="accepted">accepted</option>
        <option value="preparing">Preparing</option>
        <option value="ready">Ready</option>
        <option value="completed">Completed</option>
        <option value="cancelled">Cancelled</option>
      </select>

      <button onclick="updateOrderStatus('${order.id}')">
        Save Status
      </button>
    </div>
  `).join("");

  orders.forEach(order => {
    const select = document.getElementById("status-" + order.id);
    if (select) select.value = order.order_status || "pending";
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

  try {
    const { data: stalls, error: stallError } = await supabaseClient
      .from("stalls")
      .select("id")
      .eq("name", "Breakfast Box")
      .limit(1);

    if (stallError) throw stallError;

    if (!stalls || stalls.length === 0) {
      throw new Error("Breakfast Box stall could not be found.");
    }

    const { data: orders, error } = await supabaseClient
      .from("orders")
      .select("id, token_number, order_status, payment_status, subtotal, total_amount, created_at")
      .eq("stall_id", stalls[0].id)
      .order("created_at", { ascending: false });

    if (error) throw error;

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

    // Group food items by their order ID.
    const itemsByOrder = new Map();

    (orderItems || []).forEach(item => {
      if (!itemsByOrder.has(item.order_id)) {
        itemsByOrder.set(item.order_id, []);
      }

      itemsByOrder.get(item.order_id).push(item);
    });

    list.innerHTML = orders.map(order => {
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




async function updateOrderStatus(orderId) {
  const select = document.getElementById("status-" + orderId);
  const message = document.getElementById("ordersMessage");

  if (!select || !message) return;

  const newStatus = select.value;
  message.textContent = "Updating order status...";
console.log("Saving order:", orderId, "New status:", newStatus);
console.log("Current user:", (await supabaseClient.auth.getUser()).data.user?.id);
  let result;

  if (newStatus === "accepted") {
    result = await supabaseClient.rpc(
      "accept_order_and_deduct_stock",
      { p_order_id: orderId }
    );
  } else {
    result = await supabaseClient
      .from("orders")
      .update({ order_status: newStatus })
      .eq("id", orderId)
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
      : "Order status updated successfully!";

  await loadOrders();
}



async function loadCategoriesForEditing() {
  const select = document.getElementById("editCategorySelect");
  if (!select) return;

  select.innerHTML = '<option value="">Select a category</option>';

  const { data: stall, error: stallError } = await supabaseClient
    .from("stalls")
    .select("id")
    .eq("name", "Breakfast Box")
    .single();

  if (stallError || !stall) {
    console.error("Could not find Breakfast Box:", stallError);
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

if (window.location.pathname.endsWith("stall.html")) {
  loadStallDashboard();
  loadMenuCategories();
  loadCategoriesForEditing();
}

async function addMenuCategory() {

  const categoryName = document.getElementById("categoryName").value.trim();
  const message = document.getElementById("categoryMessage");

  if (!categoryName) {
    message.textContent = "Please enter a category name.";
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

  categories.forEach(category => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    categorySelect.appendChild(option);
  });
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

async function deleteMenuItem(itemId, itemName) {
  const accepted = confirm(
    "Are you sure you want to delete " + itemName + "?"
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

  const { data: stall, error: stallError } = await supabaseClient
    .from("stalls")
    .select("id")
    .eq("name", "Breakfast Box")
    .single();

  if (stallError) {
    console.error("Could not find stall:", stallError);
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
  const button = document.getElementById("loadReportButton");

  if (!message || !dateInput) return;

  const selectedDate = dateInput.value;

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

  message.textContent = "Loading report...";
  if (button) button.disabled = true;

  try {
    // Find the existing Breakfast Box stall.
    const { data: stalls, error: stallError } = await supabaseClient
      .from("stalls")
      .select("id, name")
      .eq("name", "Breakfast Box")
      .limit(1);

    if (stallError) throw stallError;

    if (!stalls || stalls.length === 0) {
      throw new Error("Breakfast Box stall could not be found.");
    }

    const stall = stalls[0];
    document.getElementById("reportStallName").textContent = stall.name;

    // Set the selected day's local time boundaries.
    const startDate = new Date(selectedDate + "T00:00:00");

    if (Number.isNaN(startDate.getTime())) {
      throw new Error("The selected report date is invalid.");
    }

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    // Read orders created on the selected date.
    const { data: orders, error: ordersError } = await supabaseClient
      .from("orders")
      .select(
        "id, total_amount, subtotal, payment_status, order_status, created_at, stock_deducted_at"
      )
      .eq("stall_id", stall.id)
      .gte("created_at", startDate.toISOString())
      .lt("created_at", endDate.toISOString());

    if (ordersError) throw ordersError;

    // Exclude cancelled orders.
    const validOrders = (orders || []).filter(
      order => order.order_status !== "cancelled"
    );

    // Only paid orders count as collected sales.
    const paidSales = validOrders
      .filter(order => order.payment_status === "paid")
      .reduce(
        (total, order) =>
          total + Number(order.total_amount ?? order.subtotal ?? 0),
        0
      );

    // Pending payments are shown separately, not counted as sales collected.
    const pendingPayments = validOrders
      .filter(order => order.payment_status === "pending")
      .reduce(
        (total, order) =>
          total + Number(order.total_amount ?? order.subtotal ?? 0),
        0
      );

    // Read business expenses recorded for the selected date.
    const { data: expenses, error: expensesError } = await supabaseClient
      .from("business_expenses")
      .select("amount")
      .eq("stall_id", stall.id)
      .eq("expense_date", selectedDate);

    if (expensesError) throw expensesError;

    const businessExpenses = (expenses || []).reduce(
      (total, expense) => total + Number(expense.amount || 0),
      0
    );

    // Estimate recipe cost for completed orders or orders with a recorded stock deduction.
// Costs remain provisional when recipes, ingredient prices, or stock records are incomplete.
   const eligibleOrders = validOrders.filter(
  order =>
    order.order_status === "completed" ||
    Boolean(order.stock_deducted_at)
);
const completedOrdersWithoutDeduction = validOrders.filter(
  order =>
    order.order_status === "completed" &&
    !order.stock_deducted_at
).length;
    let ingredientCost = 0;
let ingredientCostDataIncomplete = false;
    if (eligibleOrders.length > 0) {
      const orderIds = eligibleOrders.map(order => order.id);

      const { data: orderItems, error: itemsError } =
        await supabaseClient
          .from("order_items")
          .select("order_id, menu_item_id, quantity")
          .in("order_id", orderIds);

      if (itemsError) throw itemsError;

      const menuItemIds = [
        ...new Set(
          (orderItems || [])
            .map(item => item.menu_item_id)
            .filter(Boolean)
        )
      ];
if (menuItemIds.length === 0) {
  ingredientCostDataIncomplete = true;
} else {
  const { data: recipeStatuses, error: recipeStatusError } =
    await supabaseClient
      .from("menu_items")
      .select("id, recipe_complete")
      .eq("stall_id", stall.id)
      .in("id", menuItemIds);

  if (recipeStatusError) throw recipeStatusError;

  const recipeStatusMap = new Map(
    (recipeStatuses || []).map(item => [
      item.id,
      item.recipe_complete === true
    ])
  );

  if (
    menuItemIds.some(
      id => recipeStatusMap.get(id) !== true
    )
  ) {
    ingredientCostDataIncomplete = true;
  }
}
      if (menuItemIds.length > 0) {
        const { data: recipes, error: recipesError } =
          await supabaseClient
            .from("menu_item_ingredients")
            .select(
              "menu_item_id, inventory_item_id, quantity_required"
            )
            .in("menu_item_id", menuItemIds);

        if (recipesError) throw recipesError;

        const inventoryItemIds = [
          ...new Set(
            (recipes || [])
              .map(recipe => recipe.inventory_item_id)
              .filter(Boolean)
          )
        ];

        if (inventoryItemIds.length > 0) {
          const { data: ingredients, error: ingredientsError } =
            await supabaseClient
              .from("inventory_items")
              .select("id, cost_per_unit")
              .eq("stall_id", stall.id)
              .in("id", inventoryItemIds);

          if (ingredientsError) throw ingredientsError;

       const inventoryItemsById = new Map(
  (ingredients || []).map(item => [item.id, item])
);

const recipesByMenuItem = new Map();

(recipes || []).forEach(recipe => {
  if (!recipesByMenuItem.has(recipe.menu_item_id)) {
    recipesByMenuItem.set(recipe.menu_item_id, []);
  }

  recipesByMenuItem.get(recipe.menu_item_id).push(recipe);
});

// Estimate recipe cost for each ordered menu item.
(orderItems || []).forEach(item => {
  const itemRecipes =
    recipesByMenuItem.get(item.menu_item_id) || [];

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
    const ingredient =
      inventoryItemsById.get(recipe.inventory_item_id);

    const rawCost = ingredient
      ? ingredient.cost_per_unit
      : null;

    const quantityRequired = Number(recipe.quantity_required);

    const costPerUnit =
      rawCost === null || rawCost === undefined || rawCost === ""
        ? NaN
        : Number(rawCost);

    if (
      !ingredient ||
      !Number.isFinite(quantityRequired) ||
      quantityRequired <= 0 ||
      !Number.isFinite(costPerUnit) ||
      costPerUnit <= 0
    ) {
      ingredientCostDataIncomplete = true;
      return;
    }

    ingredientCost +=
      orderQuantity * quantityRequired * costPerUnit;
  });
});
       
        }
      }
    }

    // Estimated profit deducts recorded expenses and estimated
    // recipe costs from paid sales. Purchases are not deducted again.
    const estimatedProfit =
      paidSales - ingredientCost - businessExpenses;

    const formatRupees = amount =>
      "₹" + amount.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

    document.getElementById("paidSales").textContent =
      formatRupees(paidSales);

    document.getElementById("pendingPayments").textContent =
      formatRupees(pendingPayments);

    document.getElementById("businessExpenses").textContent =
      formatRupees(businessExpenses);

    const ingredientCostElement =
      document.getElementById("ingredientCost");

    if (ingredientCostElement) {
      ingredientCostElement.textContent =
        formatRupees(ingredientCost);
    }

    document.getElementById("estimatedProfit").textContent =
      formatRupees(estimatedProfit);

    const displayDate =
      String(day).padStart(2, "0") + "-" +
      String(month).padStart(2, "0") + "-" +
      String(year).slice(-2);

const costCoverageMessage =
  eligibleOrders.length === 0
    ? "No completed or stock-deducted orders were found, so ingredient cost was not calculated. ₹0.00 does not mean ingredients cost nothing. "
    : "Ingredient cost is a provisional estimate based on recorded recipes for completed or stock-deducted orders. " +
      (completedOrdersWithoutDeduction > 0
        ? completedOrdersWithoutDeduction +
          " completed order(s) have no recorded stock-deduction timestamp; recipe-based costs are included provisionally. "
        : "") +
      (ingredientCostDataIncomplete
        ? "One or more menu items are not marked recipe-complete, or recipe records or ingredient prices are missing or invalid. Ingredient cost may be understated. "
        : "");
    message.textContent =
      "Provisional report loaded for " +
      displayDate +
      ". " +
      costCoverageMessage +
      "Profit is an estimate, not verified final profit. " +
      "Incomplete recipes or missing ingredient prices may understate costs.";

  } catch (error) {
    console.error("Unable to load daily report:", error);
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


    loadDailyReport();
  }
}

/* Initialize the stall dashboard according to login status. */
if (window.location.pathname.endsWith("stall.html")) {
  (async function initializeStallDashboard() {
    const loginBox = document.getElementById("loginBox");
    const dashboard = document.getElementById("dashboard");

    if (!loginBox || !dashboard) return;

    const {
      data: { session },
      error
    } = await supabaseClient.auth.getSession();

    if (error || !session) {
      dashboard.style.display = "none";
      loginBox.style.display = "block";
      return;
    }

    loginBox.style.display = "none";
    dashboard.style.display = "block";
    await loadStalls();
  })();
}
