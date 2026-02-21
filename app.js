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
   UTIL
========================= */

const fantasyIcons = ["🌙","✨","🦋","🌹","💖","🪄","🌸","🕊️","📜","🔮","🐉","💎","🔥","🌊"];

const uuid = () => crypto.randomUUID();
const now = () => Date.now();

function safeParseArray(v) {
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* =========================
   LOCAL STATE
========================= */

let cards = safeParseArray(localStorage.getItem("cards"));
let decks = safeParseArray(localStorage.getItem("decks"));

function saveLocal() {
  localStorage.setItem("cards", JSON.stringify(cards));
  localStorage.setItem("decks", JSON.stringify(decks));
}

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
}

ensureMainDeck();

let currentDeckId = decks[0].id;
let current = 0;
let showingFront = true;

/* =========================
   CARD FACTORY
========================= */

function createCard(front = "", back = "", order = 0, deckId = currentDeckId) {
  return {
    id: uuid(),
    front,
    back,
    createdAt: now(),
    order,
    deckId
  };
}

function normalizeOrdersForDeck(deckId) {
  const deckCards = cards
    .filter(c => c.deckId === deckId)
    .sort((a, b) => a.order - b.order);

  deckCards.forEach((c, i) => (c.order = i));
}

function migrateCards() {
  if (!cards.length) {
    cards = [
      createCard("Capital of France?", "Paris", 0, currentDeckId),
      createCard("2 + 2?", "4", 1, currentDeckId)
    ];
  }

  const deckIds = new Set(decks.map(d => d.id));

  cards = cards.map((c, idx) => ({
    id: c?.id || uuid(),
    front: (c?.front ?? "").toString(),
    back: (c?.back ?? "").toString(),
    order: Number.isFinite(c?.order) ? c.order : idx,
    createdAt: Number.isFinite(c?.createdAt) ? c.createdAt : now(),
    deckId: deckIds.has(c?.deckId) ? c.deckId : currentDeckId
  }));

  decks.forEach(d => normalizeOrdersForDeck(d.id));
}

migrateCards();
saveLocal();

/* =========================
   FIRESTORE
========================= */

let currentUser = null;
let unsubscribeDecks = null;
let unsubscribeCards = null;

async function upsertDeck(deck) {
  saveLocal();
  if (!currentUser) return;
  await setDoc(doc(db, "users", currentUser.uid, "decks", deck.id), deck);
}

async function upsertCard(card) {
  saveLocal();
  if (!currentUser) return;
  await setDoc(doc(db, "users", currentUser.uid, "cards", card.id), card);
}

async function removeCard(cardId) {
  saveLocal();
  if (!currentUser) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "cards", cardId));
}

async function deleteDeck(deck) {
  if (!confirm(`Delete "${deck.name}" and all its cards?`)) return;

  cards
    .filter(c => c.deckId === deck.id)
    .forEach(c => removeCard(c.id));

  decks = decks.filter(d => d.id !== deck.id);

  if (currentDeckId === deck.id) {
    ensureMainDeck();
    currentDeckId = decks[0].id;
  }

  saveLocal();

  if (currentUser) {
    await deleteDoc(doc(db, "users", currentUser.uid, "decks", deck.id));
  }

  renderDecks();
  showCard();
}

/* =========================
   DOM
========================= */

const cardEl = document.getElementById("card");
const counterEl = document.getElementById("counter");

const currentDeckNameEl = document.getElementById("currentDeckName");
const currentDeckIconEl = document.getElementById("currentDeckIcon");

/* =========================
   UI
========================= */

function getDeckCards(deckId = currentDeckId) {
  return cards
    .filter(c => c.deckId === deckId)
    .sort((a, b) => a.order - b.order);
}

function setDeckHeader(deckId = currentDeckId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;
  currentDeckNameEl.innerText = deck.name;
  currentDeckIconEl.innerText = deck.icon;
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
  counterEl.innerText = `Card ${current + 1} of ${deckCards.length}`;
}

/* =========================
   DECK RENDER (UPDATED)
========================= */

function renameDeck(deck) {
  const newName = prompt("Rename deck:", deck.name);
  if (!newName) return;

  deck.name = newName.trim() || deck.name;
  upsertDeck(deck);
  renderDecks();
}

function renderDecks() {
  ensureMainDeck();

  const dropdown = document.getElementById("deckDropdown");
  dropdown.innerHTML = "";

  if (!decks.some(d => d.id === currentDeckId)) {
    currentDeckId = decks[0].id;
  }

  setDeckHeader(currentDeckId);

  decks.forEach(deck => {
    const item = document.createElement("div");
    item.className = "deck-item";

    const left = document.createElement("span");
    left.innerText = `${deck.icon} ${deck.name}`;

    const renameBtn = document.createElement("button");
    renameBtn.innerText = "✏️";
    renameBtn.onclick = e => {
      e.stopPropagation();
      renameDeck(deck);
    };

    const iconBtn = document.createElement("button");
    iconBtn.innerText = "🎨";
    iconBtn.onclick = e => {
      e.stopPropagation();
      openIconPicker(deck);
    };

    const deleteBtn = document.createElement("button");
    deleteBtn.innerText = "🗑";
    deleteBtn.onclick = e => {
      e.stopPropagation();
      deleteDeck(deck);
    };

    item.appendChild(left);
    item.appendChild(renameBtn);
    item.appendChild(iconBtn);
    item.appendChild(deleteBtn);

    item.onclick = () => {
      currentDeckId = deck.id;
      current = 0;
      showingFront = true;
      setDeckHeader(deck.id);
      showCard();
      dropdown.classList.remove("open");
    };

    dropdown.appendChild(item);
  });

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
    migrateCards();
    saveLocal();
    renderDecks();
    showCard();
    return;
  }

  const decksRef = query(
    collection(db, "users", user.uid, "decks"),
    orderBy("name")
  );

  unsubscribeDecks = onSnapshot(decksRef, snap => {
    const remoteDecks = snap.docs.map(d => d.data());

    if (remoteDecks.length) {
      decks = remoteDecks;
    } else {
      decks.forEach(d => upsertDeck(d));
    }

    renderDecks();
  });

  const cardsRef = query(
    collection(db, "users", user.uid, "cards"),
    orderBy("deckId"),
    orderBy("order")
  );

  unsubscribeCards = onSnapshot(cardsRef, snap => {
    const remoteCards = snap.docs.map(d => d.data());

    if (remoteCards.length) {
      cards = remoteCards;
    } else {
      cards.forEach(c => upsertCard(c));
    }

    showCard();
  });
});

/* =========================
   BOOT
========================= */

renderDecks();
showCard();
