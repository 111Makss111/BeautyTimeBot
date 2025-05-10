const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
require("dotenv").config();
const http = require("http");
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const appointments = {}; // chatId -> { date, time }
const appointmentsByDateTime = {}; // 'YYYY-MM-DD_HH:MM' -> chatId
const pendingAppointments = {}; // chatId -> { date }
const userNames = {}; // chatId -> ім'я
const userLangs = {}; // chatId -> 'ua' | 'pl'
const blockedDates = new Set();

// ======= ЛОКАЛІЗАЦІЯ =======
const texts = {
  ua: {
    chooseAction: "Оберіть дію:",
    book: "📝 Записатись",
    wifeBook: "⛔️ Заблокувати дату",
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
    blocked: (date) => `⛔️ Дата ${date} заблокована.`,
  },
  pl: {
    chooseAction: "Wybierz działanie:",
    book: "📝 Umów się",
    wifeBook: "⛔️ Zablokuj datę",
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
    blocked: (date) => `⛔️ Data ${date} została zablokowana.`,
  },
};

function getText(chatId, key, ...args) {
  const lang = userLangs[chatId] || "ua";
  const t =
    texts[lang][
      chatId.toString() === process.env.WIFE_CHAT_ID && key === "book"
        ? "wifeBook"
        : key
    ];
  return typeof t === "function" ? t(...args) : t;
}

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

bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  userNames[chatId] = query.from.first_name || "Користувач";

  if (data === "set_lang_ua" || data === "set_lang_pl") {
    const lang = data === "set_lang_ua" ? "ua" : "pl";
    userLangs[chatId] = lang;
    bot.sendMessage(chatId, getText(chatId, "languageSet"));
    showMainMenu(chatId);
    return bot.answerCallbackQuery(query.id);
  }

  if (data.startsWith("date_")) {
    const date = data.split("_")[1];

    if (
      chatId.toString() === process.env.WIFE_CHAT_ID &&
      query.message.text.includes(getText(chatId, "selectDate"))
    ) {
      if (blockedDates.has(date)) blockedDates.delete(date);
      else blockedDates.add(date);
      return bot.sendMessage(chatId, getText(chatId, "blocked", date));
    }

    if (blockedDates.has(date)) {
      return bot.sendMessage(chatId, "⛔️ Ця дата заблокована.");
    }

    pendingAppointments[chatId] = { date };
    return bot.sendMessage(chatId, getText(chatId, "enterTime", date));
  }

  return bot.answerCallbackQuery(query.id);
});

function showMainMenu(chatId) {
  const buttons = [
    [getText(chatId, "book"), getText(chatId, "view")],
    [getText(chatId, "cancel"), getText(chatId, "changeLang")],
  ];

  if (chatId.toString() === process.env.WIFE_CHAT_ID) {
    buttons.push([getText(chatId, "all")]);
  }

  bot.sendMessage(chatId, getText(chatId, "chooseAction"), {
    reply_markup: {
      keyboard: buttons,
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  });
}

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

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (!msg.text || msg.text.startsWith("/")) return;

  userNames[chatId] = msg.from.first_name || "Користувач";
  const text = msg.text.trim();

  if (text === getText(chatId, "book")) {
    return bot.sendMessage(chatId, getText(chatId, "selectDate"), {
      reply_markup: generateDateKeyboardGrid(chatId),
    });
  }

  if (text === getText(chatId, "view")) {
    const record = appointments[chatId];
    return bot.sendMessage(
      chatId,
      record
        ? getText(chatId, "yourRecord", record)
        : getText(chatId, "noRecord")
    );
  }

  if (text === getText(chatId, "cancel")) {
    const record = appointments[chatId];
    if (record) {
      delete appointmentsByDateTime[`${record.date}_${record.time}`];
      delete appointments[chatId];
      return bot.sendMessage(chatId, getText(chatId, "canceled"));
    } else {
      return bot.sendMessage(chatId, getText(chatId, "nothingToCancel"));
    }
  }

  if (text === getText(chatId, "changeLang")) {
    return bot.sendMessage(chatId, "🌐 Оберіть мову / Wybierz język:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🇺🇦 Українська", callback_data: "set_lang_ua" }],
          [{ text: "🇵🇱 Polski", callback_data: "set_lang_pl" }],
        ],
      },
    });
  }

  if (
    text === getText(chatId, "all") &&
    chatId.toString() === process.env.WIFE_CHAT_ID
  ) {
    const entries = Object.entries(appointments);
    if (!entries.length) {
      return bot.sendMessage(chatId, getText(chatId, "noAppointments"));
    } else {
      const list = entries
        .map(([id, { date, time }]) => {
          const name = userNames[id] || `ID ${id}`;
          return `👤 ${name}\n📅 ${date} ⏰ ${time}`;
        })
        .join("\n\n");
      return bot.sendMessage(
        chatId,
        `${getText(chatId, "allRecords")}\n\n${list}`
      );
    }
  }

  if (pendingAppointments[chatId]) {
    const time = text;
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
bot.onText(/\/book/, (msg) => {
  const chatId = msg.chat.id; // Отримуємо chatId з об'єкта msg
  const text = msg.text.trim(); // Отримуємо текст команди або запису
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

  if (pendingAppointments[chatId]) {
    // Тепер chatId точно визначений
    const time = text;

    if (!timeRegex.test(time)) {
      return bot.sendMessage(chatId, getText(chatId, "wrongFormat"));
    }

    const { date } = pendingAppointments[chatId];
    const key = `${date}_${time}`;

    if (!isTimeAvailable(date, time)) {
      return bot.sendMessage(chatId, getText(chatId, "alreadyTaken"));
    }

    // Якщо час раніше ніж 09:00 — запит до дружини
    const [hours] = time.split(":").map(Number);
    if (hours < 9) {
      const confirmId = `${chatId}_${date}_${time}`;
      pendingConfirmations[confirmId] = { chatId, date, time };

      bot.sendMessage(
        process.env.WIFE_CHAT_ID,
        `❓ Новий запит від ${userNames[chatId]} на ${date} о ${time}.\nПідтвердити запис?`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Так", callback_data: `confirm_yes_${confirmId}` },
                { text: "❌ Ні", callback_data: `confirm_no_${confirmId}` },
              ],
            ],
          },
        }
      );

      delete pendingAppointments[chatId];
      return bot.sendMessage(
        chatId,
        "🕐 Запит на запис відправлено майстру. Очікуйте підтвердження."
      );
    }

    // Інакше — запис без підтвердження
    appointments[chatId] = { date, time };
    appointmentsByDateTime[key] = chatId;

    bot.sendMessage(chatId, getText(chatId, "booked", date, time));
    bot.sendMessage(
      process.env.WIFE_CHAT_ID,
      `📢 Новий запис: ${userNames[chatId]}\n📅 ${date} ⏰ ${time}`
    );

    delete pendingAppointments[chatId];
  }
});

// Обробка колбеків підтвердження:
bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id; // Отримуємо chatId з об'єкта callback
  const data = query.data;

  if (data.startsWith("confirm_yes_") || data.startsWith("confirm_no_")) {
    const confirmId = data.split("_").slice(2).join("_");
    const {
      chatId: userChatId,
      date,
      time,
    } = pendingConfirmations[confirmId] || {};

    if (!userChatId) {
      return bot.answerCallbackQuery(query.id, {
        text: "⛔️ Запис вже оброблено або не знайдено.",
      });
    }

    if (data.startsWith("confirm_yes_")) {
      appointments[userChatId] = { date, time };
      appointmentsByDateTime[`${date}_${time}`] = userChatId;

      bot.sendMessage(userChatId, getText(userChatId, "booked", date, time));
      bot.sendMessage(
        chatId,
        `✅ Запис підтверджено для ${userNames[userChatId]}`
      );
    } else {
      bot.sendMessage(
        userChatId,
        "⛔️ Цей час не підходить майстру. Будь ласка, оберіть іншу дату або час."
      );
      bot.sendMessage(
        chatId,
        `❌ Відхилено запис для ${userNames[userChatId]}`
      );
    }

    delete pendingConfirmations[confirmId];
    return bot.answerCallbackQuery(query.id);
  }

  // Інша логіка callback'ів (залиш як є)
});

// Функція для надсилання нагадувань
const sendReminder = (userId, date, time) => {
  bot.sendMessage(
    userId,
    `🔔 Нагадування: завтра (${date}) у вас запис о ${time}.`
  );
};

// Задача cron, яка запускається кожен день о 10:00
cron.schedule("0 10 * * *", () => {
  const today = new Date();
  today.setDate(today.getDate() + 1); // Наступний день
  const reminderDate = today.toISOString().split("T")[0]; // Формат YYYY-MM-DD

  // Перевіряємо, чи є записи на наступний день
  if (bookings[reminderDate]) {
    bookings[reminderDate].forEach((booking) => {
      sendReminder(booking.userId, reminderDate, booking.time);
    });
  }
});
// PORT------------
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Привіт! Бот працює.");
});

const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot is running");
  })
  .listen(PORT);
