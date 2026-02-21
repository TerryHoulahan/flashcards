// app.js
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

/* =========================
   CONSTANTS
========================= */

const fantasyIcons = [
  "🌙","✨","🦋","🌹","💖","🪄","🌸",
  "🕊️","📜","🔮","🧝‍♀️","🐉","💎","🔥","🌊"
];

const uuid = () => crypto.randomUUID();
const now = () => Date.now();

/* =========================
   LOCAL STATE
========================= */

function safeParse(v) {
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let cards = safeParse(localStorage.getItem("cards"));
let decks = safeParse(localStorage.getItem("decks"));

let currentDeckId = null;
let current = 0;
let showingFront = true;
let currentUser = null;
let unsubscribeDecks = null;
let unsubscribeCards = null;

function saveLocal() {
  localStorage.setItem("cards", JSON.stringify(cards));
  localStorage.setItem("decks", JSON.stringify(decks));
}

/* =========================
   MAIN DECK GUARANTEE
========================= */

function ensureMainDeck() {
  if (!Array.isArray(decks)) decks = [];

  decks = decks.map(d => ({
    id: d?.id || uuid(),
    name: (d?.name ?? "Deck").toString(),
    icon: (d?.icon ?? "🪄").toString()
  }));

  if (decks.length === 0) {
    decks = [{ id: uuid(), name: "Main Deck", icon: "🪄" }];
  }

  if (!decks.some(d => d.name.toLowerCase() === "main deck")) {
    decks.unshift({ id: uuid(), name: "Main Deck", icon: "🪄" });
  }

  if (!currentDeckId || !decks.some(d => d.id === currentDeckId)) {
    currentDeckId = decks[0].id;
  }
}

ensureMainDeck();
saveLocal();

/* =========================
   FIRESTORE
========================= */

async function upsertDeck(deck) {
  saveLocal();
  if (!currentUser) return;
  await setDoc(doc(db, "users", currentUser.uid, "decks", deck.id), deck);
}

async function deleteDeckRemote(deckId) {
  if (!currentUser) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "decks", deckId));
}

async function upsertCard(card) {
  saveLocal();
  if (!currentUser) return;
  await setDoc(doc(db, "users", currentUser.uid, "cards", card.id), card);
}

async function deleteCardRemote(cardId) {
  if (!currentUser) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "cards", cardId));
}

/* =========================
   DOM
========================= */

const cardEl = document.getElementById("card");
const counterEl = document.getElementById("counter");
const deckDropdown = document.getElementById("deckDropdown");
const currentDeckNameEl = document.getElementById("currentDeckName");
const currentDeckIconEl = document.getElementById("currentDeckIcon");

/* =========================
   CARD HELPERS
========================= */

function getDeckCards(deckId = currentDeckId) {
  return cards
    .filter(c => c.deckId === deckId)
    .sort((a,b)=>a.order-b.order);
}

function showCard() {
  const deckCards = getDeckCards();

  if (!deckCards.length) {
    cardEl.innerText = "No cards in this deck";
    counterEl.innerText = "";
    return;
  }

  if (current >= deckCards.length) current = 0;

  const c = deckCards[current];
  cardEl.innerText = showingFront ? c.front : c.back;
  counterEl.innerText = `Card ${current+1} of ${deckCards.length}`;
}

function setDeckHeader(deckId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;

  currentDeckNameEl.innerText = deck.name;
  currentDeckIconEl.innerText = deck.icon;
}

/* =========================
   DECK ACTIONS
========================= */

function renameDeck(deck) {
  const name = prompt("Rename deck:", deck.name);
  if (!name) return;

  deck.name = name.trim();
  upsertDeck(deck);
  renderDecks();
}

function deleteDeck(deck) {
  if (deck.name === "Main Deck") {
    alert("Main Deck cannot be deleted.");
    return;
  }

  if (!confirm(`Delete "${deck.name}" and its cards?`)) return;

  cards = cards.filter(c => c.deckId !== deck.id);
  decks = decks.filter(d => d.id !== deck.id);

  deleteDeckRemote(deck.id);

  ensureMainDeck();
  renderDecks();
  showCard();
}

function addDeck() {
  const name = prompt("Deck name?");
  if (!name) return;

  const deck = {
    id: uuid(),
    name: name.trim(),
    icon: fantasyIcons[Math.floor(Math.random()*fantasyIcons.length)]
  };

  decks.push(deck);
  upsertDeck(deck);
  renderDecks();
}

/* =========================
   ICON PICKER
========================= */

function openIconPicker(deck) {
  const modal = document.getElementById("iconModal");
  const grid = document.getElementById("iconGrid");

  grid.innerHTML = "";

  fantasyIcons.forEach(icon => {
    const span = document.createElement("span");
    span.textContent = icon;
    span.onclick = () => {
      deck.icon = icon;
      upsertDeck(deck);
      modal.style.display = "none";
      renderDecks();
    };
    grid.appendChild(span);
  });

  modal.style.display = "flex";
}

function closeIconModal() {
  document.getElementById("iconModal").style.display = "none";
}

/* =========================
   RENDER DECKS
========================= */

function renderDecks() {
  ensureMainDeck();
  deckDropdown.innerHTML = "";

  decks.forEach(deck => {
    const item = document.createElement("div");
    item.className = "deck-item";

    const name = document.createElement("span");
    name.innerText = `${deck.icon} ${deck.name}`;
    name.onclick = () => {
      currentDeckId = deck.id;
      current = 0;
      showingFront = true;
      setDeckHeader(deck.id);
      showCard();
    };

    const editBtn = document.createElement("button");
    editBtn.innerText = "✏️";
    editBtn.onclick = (e) => {
      e.stopPropagation();
      renameDeck(deck);
    };

    const iconBtn = document.createElement("button");
    iconBtn.innerText = "🎨";
    iconBtn.onclick = (e) => {
      e.stopPropagation();
      openIconPicker(deck);
    };

    const deleteBtn = document.createElement("button");
    deleteBtn.innerText = "🗑";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteDeck(deck);
    };

    item.appendChild(name);
    item.appendChild(editBtn);
    item.appendChild(iconBtn);
    item.appendChild(deleteBtn);

    deckDropdown.appendChild(item);
  });

  setDeckHeader(currentDeckId);
  saveLocal();
}

/* =========================
   AUTH
========================= */

onAuthStateChanged(auth, user => {

  if (unsubscribeDecks) unsubscribeDecks();
  if (unsubscribeCards) unsubscribeCards();

  currentUser = user;

  if (!user) {
    ensureMainDeck();
    renderDecks();
    showCard();
    return;
  }

  const decksRef = query(
    collection(db, "users", user.uid, "decks"),
    orderBy("name")
  );

  unsubscribeDecks = onSnapshot(decksRef, snap => {
    const remote = snap.docs.map(d=>d.data());
    if (remote.length) {
      decks = remote;
      ensureMainDeck();
    } else {
      decks.forEach(d=>upsertDeck(d));
    }
    renderDecks();
  });

  const cardsRef = query(
    collection(db, "users", user.uid, "cards"),
    orderBy("deckId"),
    orderBy("order")
  );

  unsubscribeCards = onSnapshot(cardsRef, snap => {
    const remote = snap.docs.map(d=>d.data());
    if (remote.length) {
      cards = remote;
    } else {
      cards.forEach(c=>upsertCard(c));
    }
    showCard();
  });
});

/* =========================
   GLOBALS
========================= */

window.addDeck = addDeck;
window.openIconPicker = openIconPicker;
window.closeIconModal = closeIconModal;

/* =========================
   BOOT
========================= */

renderDecks();
showCard();
