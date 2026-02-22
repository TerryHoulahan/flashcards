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
let authReady = false;
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

  // normalize
  decks = decks.map(d => ({
    id: d?.id || uuid(),
    name: (d?.name ?? "Deck").toString(),
    icon: (d?.icon ?? "🪄").toString()
  }));

  // if empty -> seed
  if (decks.length === 0) {
    decks = [{ id: uuid(), name: "Main Deck", icon: "🪄" }];
  }

  // ensure a "Main Deck" exists by name (legacy safety)
  if (!decks.some(d => d.name.trim().toLowerCase() === "main deck")) {
    decks.unshift({ id: uuid(), name: "Main Deck", icon: "🪄" });
  }

  // ensure currentDeckId is valid
  if (!currentDeckId || !decks.some(d => d.id === currentDeckId)) {
    currentDeckId = decks[0].id;
  }
}

ensureMainDeck();
saveLocal();

/* =========================
   FIRESTORE (LOCAL-FIRST)
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
   ACCOUNT MODAL
========================= */

const accountBtn = document.getElementById("accountBtn");
const accountModal = document.getElementById("accountModal");

function openAccountModal() {
  if (accountModal) accountModal.style.display = "flex";
}

function closeAccountModal() {
  if (accountModal) accountModal.style.display = "none";
}

if (accountBtn) {
  accountBtn.addEventListener("click", openAccountModal);
}

/* =========================
   AUTH BUTTON WIRING
========================= */

const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");

const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const logoutBtn = document.getElementById("logoutBtn");
const accountStatus = document.getElementById("accountStatus");

if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    if (!email || !password) return alert("Enter email and password");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      closeAccountModal();
    } catch (err) {
      alert(err.message);
    }
  });
}

if (registerBtn) {
  registerBtn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    if (!email || !password) return alert("Enter email and password");
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      closeAccountModal();
    } catch (err) {
      alert(err.message);
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
  });
}

/* =========================
   CARD HELPERS
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

/* ---- TAP TO FLIP ---- */

function flipCard() {
  showingFront = !showingFront;
  showCard();
}

if (cardEl) {
  cardEl.addEventListener("click", flipCard);
}

function setDeckHeader(deckId) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck) return;

  if (currentDeckNameEl) currentDeckNameEl.innerText = deck.name;
  if (currentDeckIconEl) currentDeckIconEl.innerText = deck.icon;
}

function getCurrentDeck() {
  return decks.find(d => d.id === currentDeckId) || decks[0] || null;
}

/* =========================
   DECK ACTIONS
========================= */

function renameDeck(deck) {
  const name = prompt("Rename deck:", deck.name);
  if (name === null) return; // user cancelled

  const trimmed = name.trim();
  if (!trimmed) return;

  deck.name = trimmed;
  upsertDeck(deck);

  renderDecks();
  if (deck.id === currentDeckId) setDeckHeader(deck.id);
}

function deleteDeck(deck) {
  // block deleting main deck by name (and also if it's the only deck)
  if (deck.name.trim().toLowerCase() === "main deck") {
    alert("Main Deck cannot be deleted.");
    return;
  }

  if (!confirm(`Delete "${deck.name}" and its cards?`)) return;

  // remove local cards for this deck
  const removedCardIds = cards.filter(c => c.deckId === deck.id).map(c => c.id);
  cards = cards.filter(c => c.deckId !== deck.id);

  // remove local deck
  decks = decks.filter(d => d.id !== deck.id);

  // remote deletions best-effort
  deleteDeckRemote(deck.id);
  removedCardIds.forEach(id => deleteCardRemote(id));

  // reset current deck if needed
  ensureMainDeck();
  current = 0;
  showingFront = true;

  renderDecks();
  showCard();
}

function addDeck() {
  const name = prompt("Deck name?");
  if (name === null) return;

  const trimmed = name.trim();
  if (!trimmed) return;

  const deck = {
    id: uuid(),
    name: trimmed,
    icon: fantasyIcons[Math.floor(Math.random() * fantasyIcons.length)]
  };

  decks.push(deck);

  // switch to it immediately (better UX)
  currentDeckId = deck.id;
  current = 0;
  showingFront = true;

  upsertDeck(deck);
  renderDecks();
  showCard();
}

/* =========================
   ICON PICKER
========================= */

function openIconPicker(deck) {
  const modal = document.getElementById("iconModal");
  const grid = document.getElementById("iconGrid");

  if (!modal || !grid) {
    console.warn("iconModal/iconGrid missing from HTML");
    return;
  }

  grid.innerHTML = "";

  fantasyIcons.forEach(icon => {
    const span = document.createElement("span");
    span.textContent = icon;
    span.onclick = () => {
      deck.icon = icon;
      upsertDeck(deck);
      modal.style.display = "none";
      renderDecks();
      if (deck.id === currentDeckId) setDeckHeader(deck.id);
    };
    grid.appendChild(span);
  });

  modal.style.display = "flex";
}

function closeIconModal() {
  const modal = document.getElementById("iconModal");
  if (modal) modal.style.display = "none";
}

/* =========================
   DROPDOWN OPEN/CLOSE
========================= */

function toggleDeckMenu() {
  if (!deckDropdown) return;
  deckDropdown.classList.toggle("open");
}

function closeDeckMenu() {
  if (!deckDropdown) return;
  deckDropdown.classList.remove("open");
}

/* =========================
   PILL BUTTON ACTIONS
   (for your "middle button" etc)
========================= */

function renameCurrentDeck() {
  const deck = getCurrentDeck();
  if (!deck) return;
  renameDeck(deck);
}

function iconCurrentDeck() {
  const deck = getCurrentDeck();
  if (!deck) return;
  openIconPicker(deck);
}

function deleteCurrentDeck() {
  const deck = getCurrentDeck();
  if (!deck) return;
  deleteDeck(deck);
}

/* =========================
   RENDER DECKS (WITH VISIBLE BUTTONS)
========================= */

function renderDecks() {
  ensureMainDeck();
  saveLocal();

  if (!deckDropdown) return;

  deckDropdown.innerHTML = "";

  decks.forEach(deck => {
    const row = document.createElement("div");
    row.className = "deck-item";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.gap = "10px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "10px";
    left.style.flex = "1";
    left.style.cursor = "pointer";
    left.innerText = `${deck.icon} ${deck.name}`;

    left.onclick = () => {
      currentDeckId = deck.id;
      current = 0;
      showingFront = true;
      setDeckHeader(deck.id);
      showCard();
      closeDeckMenu();
    };

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.alignItems = "center";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.title = "Rename deck";
    editBtn.innerText = "✏️";
    editBtn.onclick = (e) => {
      e.stopPropagation();
      renameDeck(deck);
    };

    const iconBtn = document.createElement("button");
    iconBtn.type = "button";
    iconBtn.title = "Change icon";
    iconBtn.innerText = "🎨";
    iconBtn.onclick = (e) => {
      e.stopPropagation();
      openIconPicker(deck);
    };

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.title = "Delete deck";
    delBtn.innerText = "🗑";
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteDeck(deck);
    };

    actions.appendChild(editBtn);
    actions.appendChild(iconBtn);
    actions.appendChild(delBtn);

    row.appendChild(left);
    row.appendChild(actions);

    if (deck.id === currentDeckId) {
      row.classList.add("active");
    }

    deckDropdown.appendChild(row);
  });

  setDeckHeader(currentDeckId);
}

/* =========================
   CARD ACTIONS
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

function shuffleCards() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;

  if (!confirm("Are you sure you want to shuffle this deck?")) return;

  // Fisher-Yates shuffle
  for (let i = deckCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deckCards[i], deckCards[j]] = [deckCards[j], deckCards[i]];
  }

  deckCards.forEach((c, i) => {
    c.order = i;
    upsertCard(c);
  });

  current = 0;
  showingFront = true;
  showCard();
}

function addCard() {
  const deckCards = getDeckCards();
  const card = {
    id: uuid(),
    front: "",
    back: "",
    order: deckCards.length,
    createdAt: now(),
    deckId: currentDeckId
  };

  cards.push(card);
  current = deckCards.length;
  showingFront = true;

  upsertCard(card);
  showCard();
    openEdit();
}


/* =========================
   AUTH LISTENERS
========================= */

onAuthStateChanged(auth, user => {
  if (unsubscribeDecks) unsubscribeDecks();
  if (unsubscribeCards) unsubscribeCards();

  currentUser = user;
    authReady = true;

  // 🔥 UPDATE ACCOUNT UI STATE
  if (accountStatus) {
    if (user) {
      accountStatus.innerText = `Logged in as ${user.email}`;
      if (logoutBtn) logoutBtn.style.display = "block";
      if (loginBtn) loginBtn.style.display = "none";
      if (registerBtn) registerBtn.style.display = "none";
    } else {
      accountStatus.innerText = "Not logged in";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (loginBtn) loginBtn.style.display = "block";
      if (registerBtn) registerBtn.style.display = "block";
    }
  }

  if (!user) {
    ensureMainDeck();
    renderDecks();
    showCard();
    return;
  }

  // Decks sync
  const decksRef = query(
    collection(db, "users", user.uid, "decks"),
    orderBy("name")
  );

  unsubscribeDecks = onSnapshot(
    decksRef,
    snap => {
      const remote = snap.docs.map(d => d.data()).filter(Boolean);

      if (remote.length) {
        decks = remote;
        ensureMainDeck();
        saveLocal();
      } else {
        // remote empty -> push local once
        ensureMainDeck();
        decks.forEach(d => upsertDeck(d));
      }

      renderDecks();
    },
    err => {
      console.warn("Deck snapshot error:", err?.code || err);
      renderDecks();
    }
  );

  // Cards sync
  const cardsRef = query(
    collection(db, "users", user.uid, "cards"),
    orderBy("deckId"),
    orderBy("order")
  );

  unsubscribeCards = onSnapshot(
    cardsRef,
    snap => {
      const remote = snap.docs.map(d => d.data()).filter(Boolean);

      if (remote.length) {
        cards = remote;
        saveLocal();
      } else {
        // remote empty -> push local once
        cards.forEach(c => upsertCard(c));
      }

      showCard();
    },
    err => {
      console.warn("Cards snapshot error:", err?.code || err);
      showCard();
    }
  );
});

/* =========================
   GLOBALS FOR index.html INLINE HANDLERS
========================= */

window.addDeck = addDeck;

window.toggleDeckMenu = toggleDeckMenu;
window.closeDeckMenu = closeDeckMenu;

window.openIconPicker = openIconPicker;
window.closeIconModal = closeIconModal;
window.closeAccountModal = closeAccountModal;
window.renameCurrentDeck = renameCurrentDeck;
window.iconCurrentDeck = iconCurrentDeck;
window.deleteCurrentDeck = deleteCurrentDeck;

window.nextCard = nextCard;
window.previousCard = previousCard;
window.shuffleCards = shuffleCards;
window.addCard = addCard;
window.deleteCard = deleteCard;



/* =========================
   BOOT
========================= */

renderDecks();
showCard();

/* =========================
   CARD MODAL + CONFIRM LOGIC
   (APPENDED SAFE BLOCK)
========================= */

const modal = document.getElementById("modal");
const editFront = document.getElementById("editFront");
const editBack = document.getElementById("editBack");
const orderInput = document.getElementById("orderInput");
const orderSection = document.getElementById("orderSection");

/* ---- EDIT ---- */

function openEdit() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;

  const card = deckCards[current];

  editFront.value = card.front;
  editBack.value = card.back;
  orderInput.value = current + 1;

  modal.style.display = "flex";
}

function closeModal() {
  modal.style.display = "none";
}

function commitEditFields() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return null;

  const card = deckCards[current];

  card.front = editFront.value.trim();
  card.back = editBack.value.trim();

  // Always save locally (offline-first)
  saveLocal();

  // Write to Firestore only if logged in
  if (currentUser) {
    upsertCard(card);
  } else {
    console.warn("No authenticated user. Saved locally only.");
  }

  return card;
}

function saveEdit() {
  const card = commitEditFields();
  if (!card) return;

  closeModal();
  showCard();
}

/* ---- ORDER ---- */

function toggleOrderUI() {
  orderSection.style.display =
    orderSection.style.display === "none" ? "block" : "none";
}

function applyOrder() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;

  let newPosition = parseInt(orderInput.value) - 1;
  if (isNaN(newPosition)) return;

  if (newPosition < 0) newPosition = 0;
  if (newPosition >= deckCards.length)
    newPosition = deckCards.length - 1;

  const card = deckCards[current];

  // remove card from its deck
  const remaining = deckCards.filter(c => c.id !== card.id);

  // insert at new position
  remaining.splice(newPosition, 0, card);

  // update order values
  remaining.forEach((c, i) => {
    c.order = i;
    upsertCard(c); // keeps firestore in sync
  });

  current = newPosition;
  showingFront = true;

  closeModal();
  showCard();
}

// expose modal actions for index.html inline onclick handlers
window.openEdit = openEdit;
window.saveEdit = saveEdit;
window.clearField = clearField;
window.toggleOrderUI = toggleOrderUI;
window.applyOrder = applyOrder;
window.closeModal = closeModal;

/* ---- DELETE CONFIRM ---- */


function undoDelete() {
  if (!lastDeletedCard) return;

  cards.push(lastDeletedCard);
  upsertCard(lastDeletedCard);

  lastDeletedCard = null;
  showCard();
}

window.undoDelete = undoDelete;

/* =========================
   CLEAN SOFT DELETE
========================= */

let lastDeletedCard = null;

function deleteCard() {
  const deckCards = getDeckCards();
  if (!deckCards.length) return;

  if (!confirm("Are you sure you want to delete this card?")) return;

  const card = deckCards[current];

  lastDeletedCard = card;

  cards = cards.filter(c => c.id !== card.id);
  deleteCardRemote(card.id);

  current = 0;
  showingFront = true;
  showCard();

  setTimeout(() => {
    lastDeletedCard = null;
  }, 5000);
}

window.deleteCard = deleteCard;
window.undoDelete = undoDelete;
/* =========================
   MODAL BUTTON FIX (GLOBAL + CLEAR/UNDO)
   Append-only block
========================= */

let lastCleared = null;
let clearIsUndo = false;

function resetClearState() {
  clearIsUndo = false;
  lastCleared = null;
  const btn = document.getElementById("clearBtn");
  if (btn) btn.innerText = "Clear";
}

// Ensure clear state resets whenever modal opens/closes/saves
const _openEdit = openEdit;
openEdit = function () {
  resetClearState();
  return _openEdit();
};

const _closeModal = closeModal;
closeModal = function () {
  resetClearState();
  return _closeModal();
};

// Clear <-> Undo toggle for edit modal
function clearField() {
  const front = document.getElementById("editFront");
  const back = document.getElementById("editBack");
  const btn = document.getElementById("clearBtn");
  if (!front || !back || !btn) return;

  if (!clearIsUndo) {
    lastCleared = { front: front.value, back: back.value };
    front.value = "";
    back.value = "";
    btn.innerText = "Undo";
    clearIsUndo = true;
  } else {
    if (lastCleared) {
      front.value = lastCleared.front;
      back.value = lastCleared.back;
    }
    btn.innerText = "Clear";
    clearIsUndo = false;
  }
}

// Export ALL modal functions so inline onclick works
window.openEdit = openEdit;
window.closeModal = closeModal;
window.toggleOrderUI = toggleOrderUI;
window.applyOrder = applyOrder;
window.clearField = clearField;

/* =========================
   SWIPE SUPPORT (MOBILE)
========================= */
let startX = 0;
let startY = 0;
let isDragging = false;

const SWIPE_THRESHOLD = 80;
const AXIS_LOCK_THRESHOLD = 10;

if (cardEl) {
  cardEl.addEventListener("touchstart", (e) => {
    if (!e.touches || !e.touches.length) return;

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDragging = true;
  });

  cardEl.addEventListener("touchend", (e) => {
    if (!isDragging) return;
    if (!e.changedTouches || !e.changedTouches.length) return;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;

    const diffX = endX - startX;
    const diffY = endY - startY;

    // If vertical movement dominates, ignore swipe
    if (Math.abs(diffY) > Math.abs(diffX)) {
      isDragging = false;
      return;
    }

    // Require meaningful horizontal movement
    if (Math.abs(diffX) > SWIPE_THRESHOLD) {
      if (diffX > 0) previousCard();
      else nextCard();
    }

    isDragging = false;
  });
}
