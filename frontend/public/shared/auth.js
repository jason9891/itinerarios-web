/**
 * Auth compartido de la plataforma.
 * Los itinerarios usan esto; no redefinen Firebase config ni login.
 */
import { initializeApp } from "/vendor/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  signOut,
} from "/vendor/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAeTPLS3r-199T__22TKrPMpZVZFe8IZI8",
  authDomain: "itinerarios-2fa6f.firebaseapp.com",
  projectId: "itinerarios-2fa6f",
  storageBucket: "itinerarios-2fa6f.firebasestorage.app",
  messagingSenderId: "436339112360",
  appId: "1:436339112360:web:ed48a2b8941572a77ec59d",
  measurementId: "G-39WNFBRYSK",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/** Alias de usuarios operativos (usuario corto → email Firebase). */
export const LOGIN_ALIASES = {
  PRUEBA: "satelitalaqprac@gmail.com",
};

export {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  signOut,
};

/**
 * Wire estándar del formulario de login presente en el shell.
 * No depende de ningún itinerario.
 */
export function wireLoginForm() {
  const $ = (id) => document.getElementById(id);

  async function loginUsuario() {
    const usuario = String($("login-user")?.value || "").trim().toUpperCase();
    const password = String($("login-password")?.value || "");
    const msg = $("login-message");
    if (msg) msg.textContent = "";

    const email = LOGIN_ALIASES[usuario];
    if (!email || !password) {
      if (msg) msg.textContent = "Usuario o contraseña incorrectos.";
      return;
    }

    const button = $("user-login");
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
    const msg = $("login-message");
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (e.code === "auth/popup-blocked") {
        return signInWithRedirect(auth, provider);
      }
      if (msg) msg.textContent = e.message || "Error de autenticación";
    }
  });
}
