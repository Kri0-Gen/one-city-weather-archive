const express = require('express');
const compression = require('compression');

const app = express();
app.set('case sensitive routing', true);

app.use(compression());
app.use(express.static('src'));

app.listen(process.env.NODE_PORT);
