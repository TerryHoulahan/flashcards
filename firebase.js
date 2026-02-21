// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAQeLJ62IzW7KYrT-tgbevh72kxwoLwUO0",
  authDomain: "flashcards-sync.firebaseapp.com",
  projectId: "flashcards-sync",
  storageBucket: "flashcards-sync.firebasestorage.app",
  messagingSenderId: "953995119559",
  appId: "1:953995119559:web:3f3f4e5a7526de49ac27e2"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Offline persistence
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Firestore persistence failed: multiple tabs open.");
  } else if (err.code === "unimplemented") {
    console.warn("Firestore persistence not supported in this browser.");
  } else {
    console.warn("Firestore persistence error:", err);
  }
});
