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

const MAIN_DECK_ICON = "🪄";
const MAIN_DECK_DEFAULT_NAME = "Main Deck";

/* =========================
   HELPERS
========================= */

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function safeParseArray(v) {
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Per-user storage keys to prevent "logout shows previous user’s data".
 * Anonymous mode uses anon keys. Logged in uses uid-scoped keys.
 */
function storageKey(type, uid) {
  if (!uid) return `anon_${type}`;
  return `user_${uid}_${type}`;
}

/* =========================
   STATE (LOCAL-FIRST)
========================= */

let currentUser = null;
let unsubscribeDecks = null;
let unsubscribeCards = null;

let decks = [];
let cards = [];

let currentDeckId = null;
let current = 0;
let showingFront = true;

/* =========================
   LOCAL STORAGE LOAD/SAVE
========================= */

function loadLocal(uid) {
  decks = safeParseArray(localStorage.getItem(storageKey("decks", uid)));
  cards = safeParseArray(localStorage.getItem(storageKey("cards", uid)));
}

function saveLocal(uid = currentUser?.uid) {
  localStorage.setItem(storageKey("decks", uid), JSON.stringify(decks));
  localStorage.setItem(storageKey("cards", uid), JSON.stringify(cards));
}

/* =========================
   MAIN DECK (STABLE)
========================= */

/**
 * Main deck is identified by isMain: true (NOT by name).
 * This prevents “Main Deck disappears when renamed or when new decks added”.
 */
function ensureMainDeck() {
  if (!Array.isArray(decks)) decks = [];

  decks = decks.map(d => ({
    id: d?.id || uuid(),
    name: (d?.name ?? "Deck").toString(),
    icon: (d?.icon ?? MAIN_DECK_ICON).toString(),
    isMain: !!d?.isMain
  }));

  let main = decks.find(d => d.isMain);

  if (!main) {
    main = {
      id: uuid(),
      name: MAIN_DECK_DEFAULT_NAME,
      icon: MAIN_DECK_ICON,
      isMain: true
    };
    decks.unshift(main);
  }

  if (!currentDeckId) currentDeckId = main.id;

  // If current deck vanished, fallback to main
  if (!decks.some(d => d.id === currentDeckId)) {
    currentDeckId = main.id;
    current = 0;
    showingFront = true;
  }
}

/* =========================
   CARDS MIGRATION / NORMALIZE
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

function migrateAndNormalize() {
  ensureMainDeck();

  if (!Array.isArray(cards)) cards = [];

  // Seed if empty (anon or new user)
  if (cards.length === 0) {
    cards = [
      createCard("Capital of France?", "Paris", 0, currentDeckId),
      createCard("2 + 2?", "4", 1, currentDeckId)
    ];
  }

  // Normalize shape
  cards = cards.map((c, idx) => ({
    id: c?.id || uuid(),
    front: (c?.front ?? "").toString(),
    back: (c?.back ?? "").toString(),
    order: Number.isFinite(c?.order) ? c.order : idx,
    createdAt: Number.isFinite(c?.createdAt) ? c.createdAt : now(),
    deckId: (c?.deckId ?? currentDeckId).toString()
  }));

  // Fix missing deck references
  const deckIds = new Set(decks.map(d => d.id));
  const mainDeckId = decks.find(d => d.isMain)?.id || decks[0]?.id;

  cards = cards.map(c => {
    if (!deckIds.has(c.deckId)) c.deckId = mainDeckId;
    return c;
  });

  // Normalize each deck order
  decks.forEach(d => normalizeOrdersForDeck(d.id));
}

/* =========================
   FIRESTORE WRITES (LOCAL-FIRST)
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

async function removeCardRemote(cardId) {
  saveLocal();
  if (!currentUser) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "cards", cardId));
}

/* =========================
   DOM
========================= */

const cardEl = document.getElementById("card");
const counterEl = document.getElementById("counter");

const modal = document.getElementById("modal");
const clearBtn = document.getElementById("clearBtn");

const accountModal = document.getElementById("accountModal");
const accountBtn = document.getElementById("accountBtn");

const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const logoutBtn = document.getElementById("logoutBtn");
const accountStatus = document.getElementById("accountStatus");

const currentDeckNameEl = document.getElementById("currentDeckName");
const currentDeckIconEl = document.getElementById("currentDeckIcon");

/* =========================
   UI HELPERS
========================= */

function getDeckCards(deckId = currentDeckId) {
  return cards
    .filter(c => c.deckId === deckId)
    .sort((a, b) => a.order - b.order);
}

function setDeckHeader(deckId = currentDeckId) {
  const deck = decks.find(d => d.id === deckId) || decks.find(d => d.isMain) || decks[0];
  if (!deck) return;

  currentDeckNameEl.innerText = deck.name;
  currentDeckIconEl.innerText = deck.icon;
}

function showCard() {
  const deckCards = getDeckCards();

  if (deckCards.length === 0) {
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
   CARD ACTIONS
========================= */

function flipCard() {
  showingFront = !showingFront;
  showCard();
}

function nextCard() {
  const deckCards = getDeckCards();
  if (deckCards.length === 0) return;
  current = (current + 1) % deckCards.length;
  showingFront = true;
  showCard();
}

function previousCard() {
  const deckCards = getDeckCards();
  if (deckCards.length === 0) return;
  current = (current - 1 + deckCards.length) % deckCards.length;
  showingFront = true;
  showCard();
}

function shuffleCards() {
  if (!confirm("Shuffle cards? This will change their order.")) return;

  const deckCards = getDeckCards(currentDeckId);

  for (let i = deckCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deckCards[i], deckCards[j]] = [deckCards[j], deckCards[i]];
  }

  deckCards.forEach((c, i) => {
    c.order = i;
    upsertCard(c);
  });

  saveLocal();
  current = 0;
  showingFront = true;
  showCard();
}

function addCard() {
  const deckCards = getDeckCards();
  const newOrder = deckCards.length;

  const newCard = createCard("", "", newOrder, currentDeckId);
  cards.push(newCard);

  saveLocal();
  upsertCard(newCard);

  current = newOrder;
  showingFront = true;

  showCard();
  openEdit();
}

function deleteCard() {
  if (!confirm("Delete this card?")) return;

  const deckCards = getDeckCards();
  if (deckCards.length === 0) return;

  const cardToDelete = deckCards[current];

  cards = cards.filter(c => c.id !== cardToDelete.id);
  normalizeOrdersForDeck(currentDeckId);

  saveLocal();
  removeCardRemote(cardToDelete.id);

  current = 0;
  showingFront = true;
  showCard();
}

function moveCardTo(newIndex) {
  const deckCards = getDeckCards();
  if (deckCards.length === 0) return;

  if (newIndex < 0 || newIndex >= deckCards.length) {
    alert("Invalid position.");
    return;
  }

  const movedCard = deckCards[current];
  const without = deckCards.filter(c => c.id !== movedCard.id);
  without.splice(newIndex, 0, movedCard);

  without.forEach((c, i) => {
    c.order = i;
    upsertCard(c);
  });

  saveLocal();
  current = newIndex;
  showingFront = true;
  showCard();
}

/* =========================
   ORDER UI
========================= */

function toggleOrderUI() {
  const section = document.getElementById("orderSection");
  const input = document.getElementById("orderInput");
  const deckCards = getDeckCards();

  if (section.style.display === "none") {
    section.style.display = "block";
    input.value = deckCards.length ? (current + 1) : 1;
    input.max = deckCards.length || 1;
  } else {
    section.style.display = "none";
  }
}

function applyOrder() {
  const input = document.getElementById("orderInput");
  const deckCards = getDeckCards();

  const position = parseInt(input.value, 10);
  if (isNaN(position) || position < 1 || position > deckCards.length) {
    alert("Invalid position.");
    return;
  }

  moveCardTo(position - 1);
  document.getElementById("orderSection").style.display = "none";
}

/* =========================
   EDIT MODAL
========================= */

let lastCleared = null;

function openEdit() {
  const deckCards = getDeckCards();
  if (deckCards.length === 0) return;

  const activeCard = deckCards[current];
  document.getElementById("editFront").value = activeCard.front;
  document.getElementById("editBack").value = activeCard.back;

  clearBtn.innerText = "Clear";
  modal.style.display = "flex";
}

function closeModal() {
  modal.style.display = "none";
}

function saveEdit() {
  const deckCards = getDeckCards();
  if (deckCards.length === 0) return;

  const activeCard = deckCards[current];
  activeCard.front = document.getElementById("editFront").value;
  activeCard.back = document.getElementById("editBack").value;

  saveLocal();
  upsertCard(activeCard);

  closeModal();
  showCard();
}

function clearField() {
  const frontEl = document.getElementById("editFront");
  const backEl = document.getElementById("editBack");

  if (clearBtn.innerText === "Clear") {
    lastCleared = { front: frontEl.value, back: backEl.value };
    frontEl.value = "";
    backEl.value = "";
    clearBtn.innerText = "Undo";
  } else {
    frontEl.value = lastCleared?.front ?? "";
    backEl.value = lastCleared?.back ?? "";
    clearBtn.innerText = "Clear";
  }
}

/* =========================
   DECKS (VISIBLE ACTIONS)
========================= */

function renameDeck(deck) {
  const newName = prompt("Rename deck:", deck.name);
  if (!newName) return;

  deck.name = newName.trim() || deck.name;

  saveLocal();
  upsertDeck(deck);

  renderDecks();
  if (deck.id === currentDeckId) setDeckHeader(deck.id);
}

async function deleteDeck(deck) {
  if (decks.length <= 1) {
    alert("You must have at least one deck.");
    return;
  }

  if (deck.isMain) {
    alert("You can’t delete the Main Deck.");
    return;
  }

  if (!confirm(`Delete "${deck.name}" and all its cards?`)) return;

  // Delete cards from local + remote
  const toDelete = cards.filter(c => c.deckId === deck.id);
  cards = cards.filter(c => c.deckId !== deck.id);
  toDelete.forEach(c => removeCardRemote(c.id));

  // Delete deck
  decks = decks.filter(d => d.id !== deck.id);
  await deleteDeckRemote(deck.id);

  // If current deck deleted, go to main
  ensureMainDeck();
  currentDeckId = decks.find(d => d.isMain)?.id || decks[0].id;

  saveLocal();
  renderDecks();
  showCard();
}

function renderDecks() {
  ensureMainDeck();

  const dropdown = document.getElementById("deckDropdown");
  dropdown.innerHTML = "";

  // Ensure current deck still exists
  if (!decks.some(d => d.id === currentDeckId)) {
    ensureMainDeck();
    currentDeckId = decks.find(d => d.isMain)?.id || decks[0].id;
    current = 0;
    showingFront = true;
  }

  setDeckHeader(currentDeckId);

  decks.forEach(deck => {
    const item = document.createElement("div");
    item.className = "deck-item";
    if (deck.id === currentDeckId) item.classList.add("active");

    // Flex layout
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.justifyContent = "space-between";
    item.style.gap = "10px";

    // Label = select deck
    const label = document.createElement("div");
    label.style.flex = "1";
    label.style.cursor = "pointer";
    label.innerText = `${deck.icon} ${deck.name}`;

    label.onclick = () => {
      currentDeckId = deck.id;
      current = 0;
      showingFront = true;

      setDeckHeader(deck.id);
      dropdown.classList.remove("open");

      cardEl.style.opacity = "0";
      cardEl.style.transform = "translateY(8px)";
      setTimeout(() => {
        showCard();
        cardEl.style.opacity = "1";
        cardEl.style.transform = "translateY(0)";
      }, 150);
    };

    // Actions (visible)
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "10px";
    actions.style.alignItems = "center";

    const renameBtn = document.createElement("button");
    renameBtn.innerText = "Rename";
    renameBtn.style.padding = "6px 10px";
    renameBtn.style.borderRadius = "10px";
    renameBtn.style.cursor = "pointer";
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      renameDeck(deck);
    };

    const deleteBtn = document.createElement("button");
    deleteBtn.innerText = "Delete";
    deleteBtn.style.padding = "6px 10px";
    deleteBtn.style.borderRadius = "10px";
    deleteBtn.style.cursor = "pointer";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteDeck(deck);
    };

    // Disable delete for main
    if (deck.isMain) {
      deleteBtn.disabled = true;
      deleteBtn.style.opacity = "0.5";
      deleteBtn.style.cursor = "not-allowed";
    }

    // Icon picker still accessible via right click (optional)
    item.oncontextmenu = (e) => {
      e.preventDefault();
      openIconPicker(deck);
    };

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(label);
    item.appendChild(actions);

    dropdown.appendChild(item);
  });

  saveLocal();
}

function addDeck() {
  const name = prompt("Deck name?");
  if (!name) return;

  const deck = {
    id: uuid(),
    name: name.trim(),
    icon: fantasyIcons[Math.floor(Math.random() * fantasyIcons.length)],
    isMain: false
  };

  decks.push(deck);
  saveLocal();
  upsertDeck(deck);

  renderDecks();
}

function toggleDeckMenu() {
  document.getElementById("deckDropdown").classList.toggle("open");
}

/* =========================
   ICON PICKER MODAL
========================= */

function openIconPicker(deck) {
  const iconModal = document.getElementById("iconModal");
  const grid = document.getElementById("iconGrid");
  grid.innerHTML = "";

  fantasyIcons.forEach(icon => {
    const span = document.createElement("span");
    span.innerText = icon;
    span.onclick = () => {
      deck.icon = icon;
      saveLocal();
      upsertDeck(deck);
      iconModal.style.display = "none";
      renderDecks();
      if (deck.id === currentDeckId) setDeckHeader(deck.id);
    };
    grid.appendChild(span);
  });

  iconModal.style.display = "flex";
}

function closeIconModal() {
  document.getElementById("iconModal").style.display = "none";
}

/* =========================
   ACCOUNT MODAL
========================= */

function openAccountModal() {
  accountModal.style.display = "flex";
}
function closeAccountModal() {
  accountModal.style.display = "none";
}

accountBtn.addEventListener("click", openAccountModal);

/* =========================
   AUTH ACTIONS
========================= */

async function registerUser() {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!email || !password) {
    alert("Enter email and password.");
    return;
  }
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    emailInput.value = "";
    passwordInput.value = "";
  } catch (e) {
    alert(e.message);
  }
}

async function loginUser() {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!email || !password) {
    alert("Enter email and password.");
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
    emailInput.value = "";
    passwordInput.value = "";
  } catch (e) {
    alert(e.message);
  }
}

async function logoutUser() {
  try {
    await signOut(auth);
  } catch (e) {
    alert(e.message);
  }
}

loginBtn.addEventListener("click", loginUser);
registerBtn.addEventListener("click", registerUser);
logoutBtn.addEventListener("click", logoutUser);

/* =========================
   FIRST-LOGIN SYNC STRATEGY
========================= */

/**
 * If remote is empty, we upload local anon data to the user ONCE.
 * We only do this if remote has 0 docs.
 * This prevents overwriting a real account.
 */
let didInitialDeckUpload = false;
let didInitialCardUpload = false;

function uploadLocalToFirestoreIfRemoteEmpty(remoteDecks, remoteCards) {
  if (!currentUser) return;

  if (!didInitialDeckUpload && Array.isArray(remoteDecks) && remoteDecks.length === 0) {
    didInitialDeckUpload = true;
    ensureMainDeck();
    saveLocal(currentUser.uid);
    decks.forEach(d => upsertDeck(d));
  }

  if (!didInitialCardUpload && Array.isArray(remoteCards) && remoteCards.length === 0) {
    didInitialCardUpload = true;
    migrateAndNormalize();
    saveLocal(currentUser.uid);
    cards.forEach(c => upsertCard(c));
  }
}

/* =========================
   AUTH + REALTIME LISTENERS
========================= */

onAuthStateChanged(auth, user => {
  // Stop previous listeners
  if (unsubscribeDecks) unsubscribeDecks();
  if (unsubscribeCards) unsubscribeCards();

  currentUser = user;

  if (user) {
    accountStatus.innerText = `Logged in as ${user.email}`;
    loginBtn.style.display = "none";
    registerBtn.style.display = "none";
    logoutBtn.style.display = "block";

    // Switch local storage namespace to this user (prevents “previous user data”)
    loadLocal(user.uid);
    ensureMainDeck();
    migrateAndNormalize();
    saveLocal(user.uid);

    didInitialDeckUpload = false;
    didInitialCardUpload = false;

    const decksRef = query(
      collection(db, "users", user.uid, "decks"),
      orderBy("name")
    );

    const cardsRef = query(
      collection(db, "users", user.uid, "cards"),
      orderBy("deckId"),
      orderBy("order")
    );

    let latestRemoteDecks = null;
    let latestRemoteCards = null;

    unsubscribeDecks = onSnapshot(
      decksRef,
      snap => {
        latestRemoteDecks = snap.docs.map(d => d.data()).filter(Boolean);

        if (latestRemoteDecks.length > 0) {
          decks = latestRemoteDecks.map(d => ({
            id: d?.id || uuid(),
            name: (d?.name ?? "Deck").toString(),
            icon: (d?.icon ?? MAIN_DECK_ICON).toString(),
            isMain: !!d?.isMain
          }));
          ensureMainDeck();
          saveLocal(user.uid);
        }

        uploadLocalToFirestoreIfRemoteEmpty(latestRemoteDecks, latestRemoteCards);

        renderDecks();
        showCard();
      },
      err => {
        console.warn("Decks snapshot error:", err?.code || err);
        renderDecks();
        showCard();
      }
    );

    unsubscribeCards = onSnapshot(
      cardsRef,
      snap => {
        latestRemoteCards = snap.docs.map(d => d.data()).filter(Boolean);

        if (latestRemoteCards.length > 0) {
          cards = latestRemoteCards.map((c, idx) => ({
            id: c?.id || uuid(),
            front: (c?.front ?? "").toString(),
            back: (c?.back ?? "").toString(),
            order: Number.isFinite(c?.order) ? c.order : idx,
            createdAt: Number.isFinite(c?.createdAt) ? c.createdAt : now(),
            deckId: (c?.deckId ?? currentDeckId).toString()
          }));

          ensureMainDeck();
          const deckIds = new Set(decks.map(d => d.id));
          const mainId = decks.find(d => d.isMain)?.id || decks[0].id;

          cards = cards.map(c => {
            if (!deckIds.has(c.deckId)) c.deckId = mainId;
            return c;
          });

          saveLocal(user.uid);
        }

        uploadLocalToFirestoreIfRemoteEmpty(latestRemoteDecks, latestRemoteCards);

        showCard();
      },
      err => {
        console.warn("Cards snapshot error:", err?.code || err);
        showCard();
      }
    );

  } else {
    accountStatus.innerText = "Not logged in";
    loginBtn.style.display = "block";
    registerBtn.style.display = "block";
    logoutBtn.style.display = "none";

    // Anonymous namespace (prevents keeping user data after logout)
    loadLocal(null);
    ensureMainDeck();
    migrateAndNormalize();
    saveLocal(null);

    renderDecks();
    showCard();
  }
});

/* =========================
   INPUT EVENTS
========================= */

cardEl.addEventListener("click", flipCard);

let startX = 0;
let isDragging = false;

cardEl.addEventListener("touchstart", e => {
  startX = e.touches[0].clientX;
  isDragging = true;
});

cardEl.addEventListener("touchend", e => {
  if (!isDragging) return;
  isDragging = false;

  const endX = e.changedTouches[0].clientX;
  const diff = endX - startX;

  if (diff > 80) previousCard();
  else if (diff < -80) nextCard();
});

/* =========================
   EXPOSE GLOBALS FOR index.html
========================= */

window.previousCard = previousCard;
window.nextCard = nextCard;
window.shuffleCards = shuffleCards;

window.addCard = addCard;
window.deleteCard = deleteCard;

window.openEdit = openEdit;
window.saveEdit = saveEdit;
window.clearField = clearField;
window.closeModal = closeModal;

window.toggleOrderUI = toggleOrderUI;
window.applyOrder = applyOrder;

window.toggleDeckMenu = toggleDeckMenu;
window.addDeck = addDeck;

window.closeAccountModal = closeAccountModal;
window.closeIconModal = closeIconModal;

/* =========================
   BOOT (anon initial render)
========================= */

loadLocal(null);
ensureMainDeck();
migrateAndNormalize();
saveLocal(null);

renderDecks();
setDeckHeader(currentDeckId);
showCard();
