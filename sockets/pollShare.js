const { classInformation } = require("../modules/class")
const { database } = require("../modules/database")
const { logger } = require("../modules/logger")
const { advancedEmitToClass } = require("../modules/socketUpdates")
const { getUserClass } = require("../modules/user")

module.exports = {
    run(socket, socketUpdates) {
        // Displays previous polls
        socket.on('previousPollDisplay', (pollIndex) => {
            try {
                logger.log('info', `[previousPollDisplay] ip=(${socket.handshake.address}) session=(${JSON.stringify(socket.request.session)})`)
                logger.log('info', `[previousPollDisplay] pollIndex=(${pollIndex})`)

                advancedEmitToClass(
                    'previousPollData',
                    socket.request.session.class,
                    { classPermissions: classInformation[socket.request.session.class].permissions.controlPolls },
                    classInformation[socket.request.session.class].pollHistory[pollIndex].data
                )
            } catch (err) {
                logger.log('error', err.stack)
            }
        })

        socket.on('sharePollToUser', (pollId, username) => {
            try {
                logger.log('info', `[sharePollToUser] ip=(${socket.handshake.address}) session=(${JSON.stringify(socket.request.session)})`)
                logger.log('info', `[sharePollToUser] pollId=(${pollId}) username=(${username})`)

                database.get('SELECT * FROM users WHERE username=?', username, (err, user) => {
                    try {
                        if (err) throw err

                        if (!user) {
                            logger.log('info', 'User does not exist')
                            socket.emit('message', 'User does not exist')
                            return
                        }

                        database.get('SELECT * FROM custom_polls WHERE id=?', pollId, (err, poll) => {
                            try {
                                if (err) throw err

                                if (!poll) {
                                    logger.log('critical', 'Poll does not exist')
                                    socket.emit('message', 'Poll does not exist (Please contact the programmer)')
                                    return
                                }

                                let name = 'Unnamed Poll'
                                if (poll.name) name = poll.name
                                else if (poll.prompt) name = poll.prompt

                                database.get(
                                    'SELECT * FROM shared_polls WHERE pollId=? AND userId=?',
                                    [pollId, user.id],
                                    (err, sharePoll) => {
                                        try {
                                            if (err) throw err

                                            if (sharePoll) {
                                                socket.emit('message', `${name} is Already Shared with ${username}`)
                                                return
                                            }

                                            database.run(
                                                'INSERT INTO shared_polls (pollId, userId) VALUES (?, ?)',
                                                [pollId, user.id],
                                                async (err) => {
                                                    try {
                                                        if (err) throw err

                                                        socket.emit('message', `Shared ${name} with ${username}`)

                                                        socketUpdates.getPollShareIds(pollId)

                                                        let classCode = getUserClass(username)

                                                        if (classCode instanceof Error) throw classCode
                                                        if (!classCode) return

                                                        classInformation[classCode].students[user.username].sharedPolls.push(pollId)

                                                        socketUpdates.customPollUpdate(username)
                                                    } catch (err) {
                                                        logger.log('error', err.stack);
                                                    }
                                                }
                                            )
                                        } catch (err) {
                                            logger.log('error', err.stack);
                                        }
                                    }
                                )
                            } catch (err) {
                                logger.log('error', err.stack);
                            }
                        })
                    } catch (err) {
                        logger.log('error', err.stack);
                    }
                })
            } catch (err) {
                logger.log('error', err.stack);
            }
        })

        socket.on('removeUserPollShare', (pollId, userId) => {
            try {
                logger.log('info', `[removeUserPollShare] ip=(${socket.handshake.address}) session=(${JSON.stringify(socket.request.session)})`)
                logger.log('info', `[removeUserPollShare] pollId=(${pollId}) userId=(${userId})`)

                database.get(
                    'SELECT * FROM shared_polls WHERE pollId=? AND userId=?',
                    [pollId, userId],
                    (err, pollShare) => {
                        try {
                            if (err) throw err

                            if (!pollShare) {
                                logger.log('critical', '[removeUserPollShare] Poll is not shared to this user')
                                socket.emit('message', 'Poll is not shared to this user')
                                return
                            }

                            database.run(
                                'DELETE FROM shared_polls WHERE pollId=? AND userId=?',
                                [pollId, userId],
                                (err) => {
                                    try {
                                        if (err) throw err

                                        socket.emit('message', 'Successfully unshared user')
                                        socketUpdates.getPollShareIds(pollId)

                                        database.get('SELECT * FROM users WHERE id=?', userId, async (err, user) => {
                                            try {
                                                if (err) throw err

                                                if (!user) {
                                                    logger.log('critical', '[removeUserPollShare] User does not exist')
                                                    socket.emit('message', 'User does not exist')
                                                    return
                                                }

                                                let classCode = getUserClass(user.username)

                                                if (classCode instanceof Error) throw classCode
                                                if (!classCode) return

                                                let sharedPolls = classInformation[classCode].students[user.username].sharedPolls
                                                sharedPolls.splice(sharedPolls.indexOf(pollId), 1)
                                                socketUpdates.customPollUpdate(user.username)
                                            } catch (err) {
                                                logger.log('error', err.stack);
                                            }
                                        })
                                    } catch (err) {
                                        logger.log('error', err.stack);
                                    }
                                }
                            )
                        } catch (err) {
                            logger.log('error', err.stack);
                        }
                    }
                )
            } catch (err) {
                logger.log('error', err.stack);
            }
        })

        socket.on('removeClassPollShare', (pollId, classId) => {
            try {
                logger.log('info', `[removeClassPollShare] ip=(${socket.handshake.address}) session=(${JSON.stringify(socket.request.session)})`)
                logger.log('info', `[removeClassPollShare] pollId=(${pollId}) classId=(${classId})`)

                database.get(
                    'SELECT * FROM class_polls WHERE pollId=? AND classId=?',
                    [pollId, classId],
                    (err, pollShare) => {
                        try {
                            if (err) throw err

                            if (!pollShare) {
                                socket.emit('message', 'Poll is not shared to this class')
                                return
                            }

                            database.run(
                                'DELETE FROM class_polls WHERE pollId=? AND classId=?',
                                [pollId, classId],
                                (err) => {
                                    try {
                                        if (err) throw err

                                        socket.emit('message', 'Successfully unshared class')
                                        socketUpdates.getPollShareIds(pollId)

                                        database.get('SELECT * FROM classroom WHERE id=?', classId, async (err, classroom) => {
                                            try {
                                                if (err) throw err

                                                if (!classroom) {
                                                    logger.log('critical', 'Classroom does not exist')
                                                    return
                                                }
                                                if (!classInformation[classroom.key]) return

                                                let sharedPolls = classInformation[classroom.key].sharedPolls
                                                sharedPolls.splice(sharedPolls.indexOf(pollId), 1)
                                                for (let username of Object.keys(classInformation[classroom.key].students)) {
                                                    socketUpdates.customPollUpdate(username)
                                                }
                                            } catch (err) {
                                                logger.log('error', err.stack);
                                            }
                                        })
                                    } catch (err) {
                                        logger.log('error', err.stack)
                                    }
                                }
                            )
                        } catch (err) {
                            logger.log('error', err.stack)
                        }
                    }
                )
            } catch (err) {
                logger.log('error', err.stack)
            }
        })

        socket.on('getPollShareIds', (pollId) => {
            logger.log('info', `[getPollShareIds] ip=(${socket.handshake.address}) session=(${JSON.stringify(socket.request.session)})`)
            logger.log('info', `[getPollShareIds] pollId=(${pollId})`)

            socketUpdates.getPollShareIds(pollId)
        })

        socket.on('sharePollToClass', (pollId, classCode) => {
            try {
                logger.log('info', `[sharePollToClass] ip=(${socket.handshake.address}) session=(${JSON.stringify(socket.request.session)})`)
                logger.log('info', `[sharePollToClass] pollId=(${pollId}) classCode=(${classCode})`)

                database.get('SELECT * FROM classroom WHERE key=?', classCode, (err, classroom) => {
                    try {
                        if (err) throw err

                        if (!classroom) {
                            socket.emit('message', 'There is no class with that code.')
                            return
                        }

                        database.get('SELECT * FROM custom_polls WHERE id=?', pollId, (err, poll) => {
                            try {
                                if (err) throw err

                                if (!poll) {
                                    logger.log('critical', 'Poll does not exist (Please contact the programmer)')
                                    socket.emit('message', 'Poll does not exist (Please contact the programmer)')
                                    return
                                }

                                let name = 'Unnamed Poll'
                                if (poll.name) name = poll.name
                                else if (poll.prompt) name = poll.prompt

                                database.get(
                                    'SELECT * FROM class_polls WHERE pollId=? AND classId=?',
                                    [pollId, classroom.id],
                                    (err, sharePoll) => {
                                        try {
                                            if (err) throw err

                                            if (sharePoll) {
                                                socket.emit('message', `${name} is Already Shared with that class`)
                                                return
                                            }

                                            database.run(
                                                'INSERT INTO class_polls (pollId, classId) VALUES (?, ?)',
                                                [pollId, classroom.id],
                                                async (err) => {
                                                    try {
                                                        if (err) throw err

                                                        socket.emit('message', `Shared ${name} with that class`)

                                                        socketUpdates.getPollShareIds(pollId)

                                                        classInformation[classCode].sharedPolls.push(pollId)
                                                        for (let username of Object.keys(classInformation[classCode].students)) {
                                                            socketUpdates.customPollUpdate(username)
                                                        }
                                                    } catch (err) {
                                                        logger.log('error', err.stack)
                                                    }
                                                }
                                            )
                                        } catch (err) {
                                            logger.log('error', err.stack)
                                        }
                                    }
                                )
                            } catch (err) {
                                logger.log('error', err.stack)
                            }
                        })
                    } catch (err) {
                        logger.log('error', err.stack)
                    }
                })
            } catch (err) {
                logger.log('error', err.stack)
            }
        })
    }
}