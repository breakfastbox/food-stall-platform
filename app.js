const SUPABASE_URL = "https://anlgfcltudysjnsipsmd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x6V-O5rj20gGsoJSlbTsBw_kVuICTBv";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

async function testApp() {
  const { data, error } = await supabaseClient
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
