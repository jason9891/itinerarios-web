/**
 * Hub de itinerarios — login + selección.
 */
import { bindActiveUser } from "./shared/platform-shell.js";
import { initializeApp } from "./vendor/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  signOut,
} from "./vendor/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAeTPLS3r-199T__22TKrPMpZVZFe8IZI8",
  authDomain: "itinerarios-2fa6f.firebaseapp.com",
  projectId: "itinerarios-2fa6f",
  storageBucket: "itinerarios-2fa6f.firebasestorage.app",
  messagingSenderId: "436339112360",
  appId: "1:436339112360:web:ed48a2b8941572a77ec59d",
};

const auth = getAuth(initializeApp(firebaseConfig));
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const LOGIN_ALIASES = {
  PRUEBA: "satelitalaqprac@gmail.com",
};

const $ = (id) => document.getElementById(id);

async function loginUsuario() {
  const user = String($("login-user")?.value || "").trim().toUpperCase();
  const password = $("login-password")?.value || "";
  const email = LOGIN_ALIASES[user];
  const button = $("user-login");
  const msg = $("login-message");
  if (msg) msg.textContent = "";
  if (!email || !password) {
    if (msg) msg.textContent = "Usuario o contraseña incorrectos.";
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "INGRESANDO…";
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch {
    if (msg) msg.textContent = "Usuario o contraseña incorrectos.";
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "INGRESAR";
    }
  }
}

$("user-login")?.addEventListener("click", loginUsuario);
$("login-password")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginUsuario();
});
$("google-login")?.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e?.code === "auth/popup-blocked") return signInWithRedirect(auth, provider);
    const msg = $("login-message");
    if (msg) msg.textContent = e?.message || String(e);
  }
});
$("logout")?.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  // Siempre salir de "COMPROBANDO SESIÓN" primero
  document.body.classList.remove("auth-pending");
  try {
    bindActiveUser(user);
  } catch (e) {
    console.warn("[hub] bindActiveUser", e);
  }
  $("login")?.classList.toggle("hidden", !!user);
  $("itinerary-hub")?.classList.toggle("hidden", !user);
  $("logout")?.classList.toggle("hidden", !user);
});
