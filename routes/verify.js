const jwt = require('jsonwebtoken');
const fs = require('fs');
const publicKey = fs.readFileSync('publicKey.pem', 'utf8');
const { dbGet, dbRun } = require('../modules/database');
const { isAuthenticated } = require('../modules/authentication');
const { logNumbers } = require('../modules/config');
const { logger } = require('../modules/logger');

module.exports = {
    run(app) {
        try {
            app.get('/verify', isAuthenticated, async (req, res) => {
                const { token } = req.query.code;
                if (!token) {
                    res.render('pages/message', {
                        message: 'No token provided.',
                        title: 'Error'
                    });
                    return;
                }
                const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
                const API = await dbGet('SELECT * FROM api WHERE id = ?', [req.session.userId]);
                if (!API || !decoded) {
                    res.render('pages/message', {
                        message: 'Token is invalid or was not found.',
                        title: 'Error'
                    });
                    return;
                }
                if (API === decoded.API) {
                    dbRun('UPDATE users SET verified = 1 WHERE id = ?', [req.session.userId]);
                    req.session.verified = true;
                    res.render('pages/message', {
                        message: 'Email verified successfully.',
                        title: 'Success'
                    });
                } else {
                    res.render('pages/message', {
                        message: 'Tokens do not match.',
                        title: 'Error'
                    });
                }
            });
        } catch (err) {
            log('error', err.stack);
            res.render('pages/message', {
                message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                title: 'Error'
            });
        }
    }
}