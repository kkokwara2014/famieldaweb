/**
 * Firebase Cloud Messaging background worker for Famielda Web.
 * Keep this config in sync with js/config/firebase-config.js.
 */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAgF5zlVrzak2d3HJEPk9Ncio93dKIxvXY",
  authDomain: "famielda.firebaseapp.com",
  projectId: "famielda",
  storageBucket: "famielda.firebasestorage.app",
  messagingSenderId: "1050452616090",
  appId: "1:1050452616090:web:de179a36cac59eb90ad023",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || "Famielda";
  const options = {
    body: payload.notification?.body || payload.data?.body || "",
    icon: "/assets/favicon.png",
    data: payload.data || {},
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href || "/app/notifications.html";
  const url = href.startsWith("http") ? href : new URL(href, self.location.origin).toString();
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url.includes("/app/"));
    if (existing) {
      await existing.focus();
      if (existing.navigate) await existing.navigate(url);
      return;
    }
    await clients.openWindow(url);
  })());
});
