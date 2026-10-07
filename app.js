async function testApp() {
  const { data, error } = await supabase
    .from("stalls")
    .select("name, status")
    .limit(1);

  if (error) {
    document.getElementById("message").textContent =
      "Supabase connection error: " + error.message;
    return;
  }

  document.getElementById("message").textContent =
    "Supabase connected successfully!";
}
