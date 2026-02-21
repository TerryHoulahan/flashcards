// clean.js

/* =========================
   IMPORTS
========================= */

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

const uuid = () => crypto.randomUUID();
const now = () => Date.now();

/* =========================
   STATE
========================= */

let cards = JSON.parse(localStorage.getItem("cards") || "[]");
let decks = JSON.parse(localStorage.getItem("decks") || "[]");

let currentDeckId = null;
let current = 0;
let showingFront = true;

let currentUser = null;
let unsubscribeDecks = null;
let unsubscribeCards = null;

let editingCardId = null;
let isNewCard = false;
let lastCleared = null;
let isUndoState = false;
let lastDeletedCard = null;

/* =========================
   STORAGE
========================= */

function saveLocal() {
  localStorage.setItem("cards", JSON.stringify(cards));
  localStorage.setItem("decks", JSON.stringify(decks));
}

/* =========================
   MAIN DECK GUARANTEE
========================= */

function ensureMainDeck() {
  if (!Array.isArray(decks) || decks.length === 0) {
    decks = [{ id: uuid(), name: "Main Deck", icon: "🪄" }];
  }

  if (!currentDeckId || !decks.some(d => d.id === currentDeckId)) {
    currentDeckId = decks[0].id;
  }
}

ensureMainDeck();
saveLocal();

/* =========================
   DOM
========================= */

const cardEl = document.getElementById("card");
const counterEl = document.getElementById("counter");

const modal = document.getElementById("modal");
const editFront = document.getElementById("editFront");
const editBack = document.getElementById("editBack");
const orderInput = document.getElementById("orderInput");
const orderSection = document.getElementById("orderSection");
const clearBtn = document.getElementById("clearBtn");

/* =========================
   HELPERS
========================= */

function getDeckCards(deckId = currentDeckId) {
  return cards
    .filter(c => c.deckId === deckId)
    .sort((a, b) => a.order - b.order);
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
   NAVIGATION
========================= */

function nextCard() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;

  current = (current + 1) % deckCards.length;
  showingFront = true;
  showCard();
}

function previousCard() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;

  current = (current - 1 + deckCards.length) % deckCards.length;
  showingFront = true;
  showCard();
}

function flipCard() {
  showingFront = !showingFront;
  showCard();
}

cardEl.addEventListener("click", flipCard);

/* =========================
   SHUFFLE
========================= */

function shuffleCards() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;

  if (!confirm("Are you sure you want to shuffle this deck?")) return;

  for (let i = deckCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deckCards[i], deckCards[j]] = [deckCards[j], deckCards[i]];
  }

  deckCards.forEach((c, i) => c.order = i);

  saveLocal();
  current = 0;
  showingFront = true;
  showCard();
}

/* =========================
   ADD CARD
========================= */

function addCard() {
  const deckCards = getDeckCards();

  const card = {
    id: uuid(),
    front: "",
    back: "",
    order: deckCards.length,
    deckId: currentDeckId,
    createdAt: now()
  };

  cards.push(card);
  saveLocal();

  editingCardId = card.id;
  isNewCard = true;

  current = deckCards.length;
  openEdit();
}

/* =========================
   EDIT SYSTEM
========================= */

function openEdit() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;

  const card = deckCards[current];
  editingCardId = card.id;

  editFront.value = card.front;
  editBack.value = card.back;
  orderInput.value = card.order + 1;

  modal.style.display = "flex";
}

function closeModal() {
  modal.style.display = "none";
}

function saveEdit() {
  const card = cards.find(c => c.id === editingCardId);
  if (!card) return;

  card.front = editFront.value.trim();
  card.back = editBack.value.trim();

  saveLocal();

  editingCardId = null;
  isNewCard = false;

  closeModal();
  showCard();
}

function cancelEdit() {
  if (isNewCard && editingCardId) {
    cards = cards.filter(c => c.id !== editingCardId);
    saveLocal();
  }

  editingCardId = null;
  isNewCard = false;

  closeModal();
  showCard();
}

/* =========================
   CLEAR / UNDO
========================= */

function clearField() {
  if (!editingCardId) return;

  if (!isUndoState) {
    lastCleared = {
      front: editFront.value,
      back: editBack.value
    };

    editFront.value = "";
    editBack.value = "";

    clearBtn.innerText = "Undo";
    isUndoState = true;
  } else {
    editFront.value = lastCleared.front;
    editBack.value = lastCleared.back;

    clearBtn.innerText = "Clear";
    isUndoState = false;
  }
}

/* =========================
   ORDER SYSTEM
========================= */

function toggleOrderUI() {
  orderSection.style.display =
    orderSection.style.display === "none" ? "block" : "none";
}

function applyOrder() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;

  const newPosition = parseInt(orderInput.value) - 1;
  if (isNaN(newPosition)) return;

  const card = deckCards[current];

  const filtered = deckCards.filter(c => c.id !== card.id);
  filtered.splice(newPosition, 0, card);

  filtered.forEach((c, i) => c.order = i);

  saveLocal();
  current = newPosition;

  closeModal();
  showCard();
}

/* =========================
   DELETE (SOFT)
========================= */

function deleteCard() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;

  if (!confirm("Are you sure you want to delete this card?")) return;

  const card = deckCards[current];

  lastDeletedCard = card;

  cards = cards.filter(c => c.id !== card.id);
  saveLocal();

  current = 0;
  showingFront = true;
  showCard();

  setTimeout(() => {
    lastDeletedCard = null;
  }, 5000);
}

function undoDelete() {
  if (!lastDeletedCard) return;

  cards.push(lastDeletedCard);
  saveLocal();

  lastDeletedCard = null;
  showCard();
}

/* =========================
   SWIPE
========================= */

let startX = 0;
let isDragging = false;

cardEl.addEventListener("touchstart", e => {
  startX = e.touches[0].clientX;
  isDragging = true;
});

cardEl.addEventListener("touchend", e => {
  if (!isDragging) return;

  const diff = e.changedTouches[0].clientX - startX;

  if (diff > 80) previousCard();
  if (diff < -80) nextCard();

  isDragging = false;
});

/* =========================
   GLOBAL EXPORTS
========================= */

window.nextCard = nextCard;
window.previousCard = previousCard;
window.shuffleCards = shuffleCards;
window.addCard = addCard;
window.deleteCard = deleteCard;
window.openEdit = openEdit;
window.saveEdit = saveEdit;
window.clearField = clearField;
window.toggleOrderUI = toggleOrderUI;
window.applyOrder = applyOrder;
window.closeModal = cancelEdit;

/* =========================
   BOOT
========================= */

renderDecks?.();
showCard();
