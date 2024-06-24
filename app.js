const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);

// CORS options
const corsOptions = {
    origin: ['http://127.0.0.1:8080', 'http://127.0.0.1:5500'],
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type'],
    credentials: true
};

// Use CORS middleware
app.use(cors(corsOptions));

// Middleware
app.use(bodyParser.json());

const io = socketIo(server, {
    cors: {
        origin: ['http://127.0.0.1:8080', 'http://127.0.0.1:5500'],
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type'],
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;

// MongoDB connection
const uri = "mongodb+srv://chinedubaka2022:Jesuslovesme2022@chypto.dgryook.mongodb.net/?retryWrites=true&w=majority&appName=Chypto";
const client = new MongoClient(uri, {
    useUnifiedTopology: true,
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let db, usersCollection;
let nextUserId = 1; // Initialize the next user ID counter

async function run() {
    try {
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");

        db = client.db('Chypto');
        usersCollection = db.collection('users');

        const lastUser = await usersCollection.findOne({}, { sort: { userId: -1 } });
        if (lastUser && lastUser.userId) {
            nextUserId = lastUser.userId + 1;
        }

        server.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });

    } catch (err) {
        console.error('Failed to connect to MongoDB', err);
        process.exit(1);
    }
}
run().catch(console.dir);

let coins = 10000; // Default coins
let energy = 1000;
let chargeSpeed = 1;
let coinBotActive = false;
let coinBotInterval = null;
let lastLoginTime = new Date();

// Initialize the Telegram Bot
const botToken = '6478165635:AAF0XtrVbQb8YptnY3jkIprdfMOwHOYcdCA';
const bot = new TelegramBot(botToken, { polling: true });

// Function to start the Coin Bot
function startCoinBot(userId) {
    coinBotActive = true;
    coinBotInterval = setInterval(async () => {
        if (coinBotActive) {
            const now = new Date();
            const hoursInactive = (now - lastLoginTime) / (1000 * 60 * 60); // Convert milliseconds to hours

            if (hoursInactive >= 6) {
                coinBotActive = false;
                clearInterval(coinBotInterval);
                console.log('Coin Bot paused due to user inactivity.');
            } else {
                const coinsToAdd = calculateCoinsToAdd();
                await usersCollection.updateOne(
                    { userId: userId },
                    { $inc: { coins: coinsToAdd } },
                    { upsert: true }
                );
                emitCoinBalance(userId);
            }
        }
    }, 60000); // 1 minute interval
}

// Function to calculate coins to add per minute
function calculateCoinsToAdd() {
    return 166.6666; // Example calculation
}

// Function to stop the Coin Bot
function stopCoinBot() {
    coinBotActive = false;
    clearInterval(coinBotInterval);
}

// Route to fetch current coin balance
app.get('/api/coins', async (req, res) => {
    const userId = req.query.userId;
    const user = await usersCollection.findOne({ userId: userId });
    const userCoins = user ? user.coins : coins;
    res.json({ balance: userCoins });
});

// Route to update coin balance (PUT request)
app.put('/api/coins', async (req, res) => {
    const { userId, balance } = req.body;
    if (typeof balance === 'number') {
        await usersCollection.updateOne(
            { userId: userId },
            { $set: { coins: balance } },
            { upsert: true }
        );
        emitCoinBalance(userId);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Invalid balance value' });
    }
});

// Route to update coin balance based on task completion (POST request)
app.post('/updateBalance', async (req, res) => {
    const { userId, task, reward } = req.body;

    if (!task || !reward) {
        console.error('Invalid request body:', req.body);
        return res.status(400).json({ error: 'Invalid request body' });
    }

    if (typeof reward !== 'number' || reward <= 0) {
        console.error('Invalid reward value:', reward);
        return res.status(400).json({ error: 'Invalid reward value' });
    }

    await usersCollection.updateOne(
        { userId: userId },
        { $inc: { coins: reward } },
        { upsert: true }
    );
    emitCoinBalance(userId);
    res.json({ success: true });
});

// Route to activate boosts
app.post('/api/boosts', async (req, res) => {
    const { userId, type, cost } = req.body;

    const user = await usersCollection.findOne({ userId: userId });
    const userCoins = user ? user.coins : coins;

    if (userCoins >= cost) {
        switch (type) {
            case 'tap':
            case 'energy':
            case 'chargeSpeed':
            case 'coinBot':
                await usersCollection.updateOne(
                    { userId: userId },
                    { $inc: { coins: -cost } },
                    { upsert: true }
                );
                if (type === 'coinBot' && !coinBotActive) {
                    startCoinBot(userId);
                }
                res.json({ success: true });
                break;
            default:
                res.status(400).json({ error: 'Invalid boost type' });
        }
    } else {
        res.status(400).json({ error: 'Not enough coins' });
    }
});

// Socket.io connection listener
io.on('connection', async (socket) => {
    const userId = socket.handshake.query.userId;
    const telegramUsername = socket.handshake.query.telegramUsername;

    console.log('A user connected:', userId, telegramUsername);

    // Emit initial data to the client
    socket.emit('coinBalance', await getCoinBalance(userId));

    socket.on('disconnect', () => {
        console.log('User disconnected:', userId);
    });
});

// Emit current coin balance to all connected clients
async function emitCoinBalance(userId) {
    const user = await usersCollection.findOne({ userId: userId });
    const userCoins = user ? user.coins : coins;
    io.emit('coinBalance', userCoins); // Emit updated balance to all clients
}

// Function to send a Telegram message
async function sendTelegramMessage(chatId, message) {
    try {
        await bot.sendMessage(chatId, message);
    } catch (error) {
        console.error('Error sending message to Telegram:', error);
    }
}

// Listen for messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    console.log(`Received message from ${chatId}: ${text}`);

    // Respond to the message
    if (text.toLowerCase() === '/balance') {
        const user = await usersCollection.findOne({ telegramUsername: msg.from.username });
        if (user) {
            sendTelegramMessage(chatId, `Your current balance is ${user.coins} coins.`);
        } else {
            sendTelegramMessage(chatId, "User not found.");
        }
    } else {
        sendTelegramMessage(chatId, "I didn't understand that command.");
    }
});

async function getCoinBalance(userId) {
    const user = await usersCollection.findOne({ userId: userId });
    return user ? user.coins : coins;
}

// Update documents where userId exists but telegramUsername is null
async function updateTelegramUsernames() {
    try {
        const result = await usersCollection.updateMany(
            { telegramUsername: null },
            { $set: { telegramUsername: "updating username" } }
        );
        console.log(`Updated ${result.modifiedCount} documents`);
    } catch (error) {
        console.error('Error updating documents:', error);
    }
}

// Call the function to update documents on startup
updateTelegramUsernames();

