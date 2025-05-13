const { database } = require("../modules/database");
const { logger } = require("../modules/logger");

module.exports = {
    run(socket) {
        socket.on('verifyUser', async (userId) => {
            logger.log('info', `[verifyUser] Verifying user ${userId}`);
            dbRun('UPDATE users SET verified = ? WHERE id = ?', [1, userId])
                .catch((err) => {
                    logger.log('error', `[verifyUser] Error verifying user ${userId}: ${err}`);
                    socket.emit('error', { message: 'Error verifying user' });
                });
        });
    }
}