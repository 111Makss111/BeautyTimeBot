# BeautyTimeBot

bot.onText(/\/start/, (msg) => {
bot.sendMessage(msg.chat.id, 'Привіт! Бот працює.')
})

const PORT = process.env.PORT || 3000
http.createServer((req, res) => {
res.writeHead(200)
res.end('Bot is running')
}).listen(PORT)
