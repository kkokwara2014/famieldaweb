/**
 * Shared Firebase project for Famielda Web and Famielda Mobile.
 *
 * This web app signs in against Authentication users in project `famielda`
 * and reads/writes the default Firestore database so household data stays
 * in sync with the mobile app.
 *
 * Console setup for this module:
 * - Enable Email/Password in Authentication → Sign-in method
 * - Add this web domain (and localhost) under Authentication → Settings → Authorized domains
 * - Set the email action URL to https://famielda.web.app/auth-action.html
 *   so password reset and email verification stay on Famielda, not the default Firebase page
 * - Enable Cloud Storage and deploy firebase/storage.rules so household documents stay private
 * - Enable Cloud Messaging, generate a Web Push certificate (VAPID) under
 *   Project settings → Cloud Messaging, and paste it as vapidKey below
 * - Stripe secret keys and the webhook signing secret belong on Cloud Functions
 *   only (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET). Never paste them into this
 *   file or any other client script. Checkout is created server-side.
 */
export const functionsRegion = "us-central1";

export const firebaseConfig = {
  apiKey: "AIzaSyAgF5zlVrzak2d3HJEPk9Ncio93dKIxvXY",
  authDomain: "famielda.firebaseapp.com",
  projectId: "famielda",
  storageBucket: "famielda.firebasestorage.app",
  messagingSenderId: "1050452616090",
  appId: "1:1050452616090:web:de179a36cac59eb90ad023",
  measurementId: "G-DMR39LQ9Q9",
};

export const fcmVapidKey = "YOUR_VAPID_KEY";

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey) && firebaseConfig.apiKey !== "YOUR_API_KEY";
}

export function isFcmConfigured() {
  return isFirebaseConfigured() && Boolean(fcmVapidKey) && fcmVapidKey !== "YOUR_VAPID_KEY";
}
