const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
require("dotenv").config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userNames[chatId] = msg.from.first_name || "Користувач";

  bot.sendMessage(chatId, "🌐 Оберіть мову / Wybierz język:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🇺🇦 Українська", callback_data: "set_lang_ua" }],
        [{ text: "🇵🇱 Polski", callback_data: "set_lang_pl" }],
      ],
    },
  });
});
const appointments = {}; // chatId -> { date, time }
const appointmentsByDateTime = {}; // 'YYYY-MM-DD_HH:MM' -> chatId
const pendingAppointments = {}; // chatId -> { date }
const userNames = {}; // chatId -> ім'я
const userLangs = {}; // chatId -> 'ua' | 'pl'

// ======= ЛОКАЛІЗАЦІЯ =======
const texts = {
  ua: {
    chooseAction: "Оберіть дію:",
    book: "📝 Записатись",
    view: "📋 Переглянути запис",
    cancel: "❌ Скасувати запис",
    all: "📖 Всі записи",
    noRecord: "ℹ️ Ви ще не записані.",
    enterTime: (date) => `🕐 Введіть час для ${date} у форматі HH:MM`,
    yourRecord: ({ date, time }) => `📅 Ваш запис:\n${date} о ${time}`,
    canceled: "✅ Запис скасовано.",
    nothingToCancel: "ℹ️ У вас немає запису.",
    booked: (date, time) => `✅ Ви записані на ${date} о ${time}.`,
    alreadyTaken: "❌ Цей час вже зайнятий.",
    wrongFormat: "⛔️ Формат невірний. Приклад: 14:30",
    reminder: (date, time) =>
      `🔔 Нагадування: завтра (${date}) у вас запис о ${time}.`,
    allRecords: "📖 Усі записи:",
    noAppointments: "ℹ️ Записів немає.",
    languageSet: "✅ Мова встановлена: Українська 🇺🇦",
    selectDate: "📅 Оберіть дату:",
    changeLang: "🌐 Змінити мову",
  },
  pl: {
    chooseAction: "Wybierz działanie:",
    book: "📝 Umów się",
    view: "📋 Zobacz spotkanie",
    cancel: "❌ Anuluj spotkanie",
    all: "📖 Wszystkie spotkania",
    noRecord: "ℹ️ Nie masz jeszcze spotkania.",
    enterTime: (date) => `🕐 Podaj godzinę dla ${date} (format HH:MM)`,
    yourRecord: ({ date, time }) => `📅 Twoje spotkanie:\n${date} o ${time}`,
    canceled: "✅ Spotkanie anulowane.",
    nothingToCancel: "ℹ️ Nie masz spotkania.",
    booked: (date, time) => `✅ Umówiono na ${date} o ${time}.`,
    alreadyTaken: "❌ Ta godzina jest zajęta.",
    wrongFormat: "⛔️ Błędny format. Przykład: 14:30",
    reminder: (date, time) =>
      `🔔 Przypomnienie: jutro (${date}) masz spotkanie o ${time}.`,
    allRecords: "📖 Wszystkie spotkania:",
    noAppointments: "ℹ️ Brak zapisów.",
    languageSet: "✅ Ustawiono język: Polski 🇵🇱",
    selectDate: "📅 Wybierz datę:",
    changeLang: "🌐 Zmień język",
  },
};

function getText(chatId, key, ...args) {
  const lang = userLangs[chatId] || "ua";
  const t = texts[lang][key];
  return typeof t === "function" ? t(...args) : t;
}

// === КНОПКА ЗМІНИ МОВИ ===
bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === "set_lang_ua" || data === "set_lang_pl") {
    const lang = data === "set_lang_ua" ? "ua" : "pl";
    userLangs[chatId] = lang;
    bot.sendMessage(chatId, getText(chatId, "languageSet"));
    showMainMenu(chatId);
    return bot.answerCallbackQuery(query.id);
  }
});

// === МЕНЮ ===
function showMainMenu(chatId) {
  const buttons = [
    [{ text: getText(chatId, "book"), callback_data: "book" }],
    [{ text: getText(chatId, "view"), callback_data: "view" }],
    [{ text: getText(chatId, "cancel"), callback_data: "cancel" }],
    [{ text: getText(chatId, "changeLang"), callback_data: "lang" }],
  ];

  if (chatId.toString() === process.env.WIFE_CHAT_ID) {
    buttons.push([
      { text: getText(chatId, "all"), callback_data: "all_records" },
    ]);
  }

  bot.sendMessage(chatId, getText(chatId, "chooseAction"), {
    reply_markup: { inline_keyboard: buttons },
  });
}

// === КНОПКИ КАЛЕНДАРЯ ===
function generateDateKeyboardGrid(chatId) {
  const keyboard = [];
  const today = new Date();
  const weekdaysUA = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const weekdaysPL = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "Sb"];
  const monthsUA = [
    "січ",
    "лют",
    "бер",
    "квіт",
    "трав",
    "черв",
    "лип",
    "сер",
    "вер",
    "жовт",
    "лист",
    "груд",
  ];
  const monthsPL = [
    "sty",
    "lut",
    "mar",
    "kwi",
    "maj",
    "cze",
    "lip",
    "sie",
    "wrz",
    "paź",
    "lis",
    "gru",
  ];

  const lang = userLangs[chatId] || "ua";
  const weekdays = lang === "pl" ? weekdaysPL : weekdaysUA;
  const months = lang === "pl" ? monthsPL : monthsUA;

  for (let i = 0; i < 5; i++) {
    const row = [];
    for (let j = 0; j < 4; j++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i * 4 + j);
      const yyyy_mm_dd = date.toISOString().split("T")[0];
      const weekday = weekdays[date.getDay()];
      const day = date.getDate().toString().padStart(2, "0");
      const month = months[date.getMonth()];
      row.push({
        text: `${day} ${weekday} ${month}`,
        callback_data: `date_${yyyy_mm_dd}`,
      });
    }
    keyboard.push(row);
  }

  return { inline_keyboard: keyboard };
}

// === ОБРОБКА CALLBACK ДІЙ ===
bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;
  userNames[chatId] = query.from.first_name || "Користувач";

  if (action === "book") {
    bot.sendMessage(chatId, getText(chatId, "selectDate"), {
      reply_markup: generateDateKeyboardGrid(chatId),
    });
  }

  if (action.startsWith("date_")) {
    const selectedDate = action.split("_")[1];
    pendingAppointments[chatId] = { date: selectedDate };
    bot.sendMessage(chatId, getText(chatId, "enterTime", selectedDate));
  }

  if (action === "view") {
    const record = appointments[chatId];
    if (record) {
      bot.sendMessage(chatId, getText(chatId, "yourRecord", record));
    } else {
      bot.sendMessage(chatId, getText(chatId, "noRecord"));
    }
  }

  if (action === "cancel") {
    const record = appointments[chatId];
    if (record) {
      delete appointmentsByDateTime[`${record.date}_${record.time}`];
      delete appointments[chatId];
      bot.sendMessage(chatId, getText(chatId, "canceled"));
    } else {
      bot.sendMessage(chatId, getText(chatId, "nothingToCancel"));
    }
  }

  if (
    action === "all_records" &&
    chatId.toString() === process.env.WIFE_CHAT_ID
  ) {
    const entries = Object.entries(appointments);
    if (!entries.length) {
      bot.sendMessage(chatId, getText(chatId, "noAppointments"));
    } else {
      const list = entries
        .map(([id, { date, time }]) => {
          const name = userNames[id] || `ID ${id}`;
          return `👤 ${name}\n📅 ${date} ⏰ ${time}`;
        })
        .join("\n\n");
      bot.sendMessage(chatId, `${getText(chatId, "allRecords")}\n\n${list}`);
    }
  }

  if (action === "lang") {
    bot.sendMessage(chatId, "🌐 Оберіть мову / Wybierz język:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🇺🇦 Українська", callback_data: "set_lang_ua" }],
          [{ text: "🇵🇱 Polski", callback_data: "set_lang_pl" }],
        ],
      },
    });
  }

  bot.answerCallbackQuery(query.id);
});

// === ОБРОБКА ТЕКСТУ ===
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (!msg.text || msg.text.startsWith("/")) return;

  userNames[chatId] = msg.from.first_name || "Користувач";

  if (pendingAppointments[chatId]) {
    const time = msg.text.trim();
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

    if (!timeRegex.test(time)) {
      return bot.sendMessage(chatId, getText(chatId, "wrongFormat"));
    }

    const { date } = pendingAppointments[chatId];
    const key = `${date}_${time}`;

    if (appointmentsByDateTime[key]) {
      return bot.sendMessage(chatId, getText(chatId, "alreadyTaken"));
    }

    appointments[chatId] = { date, time };
    appointmentsByDateTime[key] = chatId;

    bot.sendMessage(chatId, getText(chatId, "booked", date, time));
    bot.sendMessage(
      process.env.WIFE_CHAT_ID,
      `📢 Новий запис: ${userNames[chatId]}\n📅 ${date} ⏰ ${time}`
    );

    delete pendingAppointments[chatId];
  } else {
    showMainMenu(chatId);
  }
});

// === НАГАДУВАННЯ О 12:00 ===
cron.schedule("0 12 * * *", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyy_mm_dd = tomorrow.toISOString().split("T")[0];

  for (const [chatId, { date, time }] of Object.entries(appointments)) {
    if (date === yyyy_mm_dd) {
      bot.sendMessage(chatId, getText(chatId, "reminder", date, time));
    }
  }
});
