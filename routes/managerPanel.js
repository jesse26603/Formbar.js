const { isLoggedIn, permCheck } = require("../modules/authentication")
const { logNumbers } = require("../modules/config")
const { logger } = require("../modules/logger")

module.exports = {
    run(app) {
        app.get('/managerPanel', isLoggedIn, permCheck, (req, res) => {
            try {
                logger.log('info', `[get /managerPanel] ip=(${req.ip}) session=(${JSON.stringify(req.session)})`)
        
                res.render('pages/managerPanel', {
                    title: 'Manager Panel'
                })
            } catch (err) {
                logger.log('error', err.stack);
                res.render('pages/message', {
                    message: `Error Number ${logNumbers.error}: There was a server error try again.`,
                    title: 'Error'
                })
            }
        })
    }
}