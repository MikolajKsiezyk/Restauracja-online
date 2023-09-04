const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const User = require('./models/user');
const Recipe = require('./models/recipe');
const Cart = require('./models/cart'); 
const order = require('./models/order');
const LocalStrategy = require('passport-local');
const passport = require('passport');
const multer = require('multer');

const url = "mongodb://127.0.0.1/recipe_app"
const app = express();

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'));
app.use(session({
    secret: 'anyRandomSecretString', 
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(passport.initialize());
app.use(passport.session());

app.use('/public', express.static('public'));

passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());


mongoose.connect(url, {})
    .then(result => console.log("database connected"))
    .catch(err => console.log(err))

app.get('/', async (req, res) => {
    try {
        const { category, difficulty } = req.query;

        const filter = {};
        if (category) filter.category = category;
        if (difficulty) filter.difficulty = difficulty;

        const recipes = await Recipe.find(filter).populate('createdBy').exec();
        res.render('index', { 
            user: req.user,
            recipes: recipes
        });
    } catch (err) {
        console.log(err);
        res.status(500).send('Wystąpił błąd podczas pobierania przepisów.');
    }
});

app.listen(3000, () => {
    console.log('Server started on port 3000');
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login'
}));

app.get('/logout', (req, res) => {
    req.logout();
    res.redirect('/');
});

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', (req, res) => {
    User.register(new User({username: req.body.username}), req.body.password, (err, user) => {
        if(err) {
            return res.render('register', { error: err.message });
        }
        passport.authenticate('local')(req, res, () => {
            res.redirect('/');
        });
    });
});

app.get('/add-recipe', (req, res) => {
    res.render('add-recipe');
});

app.post('/add-recipe', async (req, res) => {
    try {
        const recipeData = req.body;
        recipeData.createdBy = req.user._id;
        const newRecipe = new Recipe(recipeData);
        await newRecipe.save();
        res.redirect('/'); 
    } catch (err) {
        console.log(err);
        res.status(500).send('Wystąpił błąd podczas dodawania przepisu.');
    }
});

app.get('/recipe/:id', async (req, res) => {
    try {
        const recipe = await Recipe.findById(req.params.id).populate('createdBy');
        console.log("Znaleziony przepis:", recipe);  

        if (recipe) {
            res.render('recipe', { recipe: recipe });
        } else {
            res.status(404).send("Przepis nie został znaleziony.");
        }
    } catch (error) {
        console.error("Wystąpił błąd:", error);
        res.status(500).send("Wystąpił błąd serwera.");
    }
});

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, './uploads/'); 
    },
    filename: function(req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname); 
    }
});

const upload = multer({ storage: storage });

app.post('/add-recipe', upload.single('image'), (req, res) => {
    const imageUrl = './uploads/' + req.file.filename;
});

app.post('/add-to-cart/:recipeId', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(403).send('Musisz się zalogować, żeby dodać przepis do koszyka.');
    }
    try {
        const recipeId = req.params.recipeId;
        const userId = req.user._id;

        let cart = await Cart.findOne({ userId: userId });
        if (!cart) {
            cart = new Cart({ userId: userId, items: [] });
        }

        if (cart.items && !cart.items.some(item => item.recipeId.toString() === recipeId)) {
            cart.items.push({ recipeId: recipeId, quantity: 1 });
        }
        
        await cart.save();
        res.redirect('/'); 
    } catch (err) {
        console.log(err);
        res.status(500).send('Wystąpił błąd podczas dodawania do koszyka.');
    }
});

// Wyświetlanie koszyka
app.get('/cart', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(403).send('Musisz się zalogować, żeby zobaczyć koszyk.');
    }
    try {
        let cart = await Cart.findOne({ userId: req.user._id }).populate('items.recipeId');
        console.log("Cart:", cart);
        if (!cart) {
            cart = {};  // albo coś, co ma sens w kontekście twojej aplikacji
        }
        res.render('cart', { cart });
    } catch (err) {
        console.log(err);
        res.status(500).send('Wystąpił błąd podczas pobierania koszyka.');
    }
});

app.post('/update-cart/:itemId', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(403).send('Musisz się zalogować, żeby zarządzać koszykiem.');
    }
    try {
        const itemId = req.params.itemId;
        const action = req.body.action;
        const quantity = req.body.quantity;
        
        let cart = await Cart.findOne({ userId: req.user._id });
        
        const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
        
        if (itemIndex === -1) {
            return res.status(404).send("Nie znaleziono takiego przedmiotu w koszyku.");
        }
        
        if (action === "update") {
            cart.items[itemIndex].quantity = quantity;
        } else if (action === "remove") {
            cart.items.splice(itemIndex, 1);
        }
        
        await cart.save();
        res.redirect('/cart'); 
    } catch (err) {
        console.log(err);
        res.status(500).send('Wystąpił błąd podczas aktualizacji koszyka.');
    }
});

app.get('/order', (req, res) => {
  res.render('order');
});

app.post('/order', async (req, res) => {
  try {
    const { address, phoneNumber, items } = req.body;

    const newOrder = new order({
      orderId: new mongoose.Types.ObjectId().toString(),
      address,
      phoneNumber,
      items
    });

    await newOrder.save();

    res.redirect('/');
  } catch (error) {
    console.log(error);
    res.status(500).send('Wystąpił błąd podczas składania zamówienia.');
  }
});

app.get('/thenk-you', (req, res) => {
    res.render('thanks');
  });

