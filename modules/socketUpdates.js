// @TODO: Organize all of this

const { classInformation } = require("./class");
const { settings } = require("./config");
const { database } = require("./database");
const { logger } = require("./logger");
const { TEACHER_PERMISSIONS, CLASS_SOCKET_PERMISSIONS } = require("./permissions");
const { io } = require("./webServer");

const runningTimers = {};
const rateLimits = {}
const userSockets = {}

/**
	 * Emits an event to sockets based on user permissions
	 * @param {string} event - The event to emit
	 * @param {string} classCode - The code of the class
	 * @param {{permissions?: number, classPermissions?: number, api?: boolean, username?: string}} options - The options object
	 * @param  {...any} data - Additional data to emit with the event
	 */
async function advancedEmitToClass(event, classCode, options, ...data) {
	let classData = classInformation[classCode]

	let sockets = await io.in(`class-${classCode}`).fetchSockets()

	for (let socket of sockets) {
		let user = classData.students[socket.request.session.username]
		let hasAPI = false

		if (!user) continue

		if (options.permissions && user.permissions < options.permissions) continue
		if (options.classPermissions && user.classPermissions < options.classPermissions) continue
		if (options.username && user.username != options.username) continue

		for (let room of socket.rooms) {
			if (room.startsWith('api-')) {
				hasAPI = true
				break
			}
		}
		if (options.api == true && !hasAPI) continue
		if (options.api == false && hasAPI) continue

		socket.emit(event, ...data)
	}
}

/**
 * Sets the class code for all sockets in a specific API.
 * If no class code is provided, the default value is 'noClass'.
 *
 * @param {string} api - The API identifier.
 * @param {string} [classCode='noClass'] - The class code to set.
 */
async function setClassOfApiSockets(api, classCode) {
	logger.log('verbose', `[setClassOfApiSockets] api=(${api}) classCode=(${classCode})`);

	const sockets = await io.in(`api-${api}`).fetchSockets()
	for (let socket of sockets) {
		socket.leave(`class-${socket.request.session.class}`)

		socket.request.session.class = classCode || 'noClass'
		socket.request.session.save()

		socket.join(`class-${socket.request.session.class}`)
		socket.emit('setClass', socket.request.session.class)
	}
}

function runQuery(query, params) {
	return new Promise((resolve, reject) => {
		database.run(query, params, (err) => {
			if (err) reject(new Error(err))
			else resolve()
		})
	})
}

class SocketUpdates {
    constructor(socket) {
        this.socket = socket;
    }

    classPermissionUpdate(classCode = this.socket.request.session.class) {
        try {
            logger.log('info', `[classPermissionUpdate] classCode=(${classCode})`)
    
            let classData = classInformation[classCode]
            let cpPermissions = Math.min(
                classData.permissions.controlPolls,
                classData.permissions.manageStudents,
                classData.permissions.manageClass
            )
    
            advancedEmitToClass('cpUpdate', classCode, { classPermissions: cpPermissions }, classData)
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    virtualBarUpdate(classCode = this.socket.request.session.class) {
        try {
            logger.log('info', `[virtualBarUpdate] classCode=(${classCode})`)
    
            if (!classCode) return
            if (classCode == 'noClass') return
    
            let classData = structuredClone(classInformation[classCode])
            let responses = {}
    
            // for (let [username, student] of Object.entries(classData.students)) {
            // 	if (
            // 		student.break == true ||
            // 		student.classPermissions <= STUDENT_PERMISSIONS ||
            // 		student.classPermissions >= TEACHER_PERMISSIONS
            // 	) delete classData.students[username]
            // }
    
            if (Object.keys(classData.poll.responses).length > 0) {
                for (let [resKey, resValue] of Object.entries(classData.poll.responses)) {
                    responses[resKey] = {
                        ...resValue,
                        responses: 0
                    }
                }
    
                for (let studentData of Object.values(classData.students)) {
                    if (Array.isArray(studentData.pollRes.buttonRes)) {
                        for (let response of studentData.pollRes.buttonRes) {
                            if (
                                studentData &&
                                Object.keys(responses).includes(response)
                            ) {
                                responses[response].responses++
                            }
                        }
    
                    } else if (
                        studentData &&
                        Object.keys(responses).includes(studentData.pollRes.buttonRes)
                    ) {
                        responses[studentData.pollRes.buttonRes].responses++
                    }
                }
            }
    
            logger.log('verbose', `[virtualBarUpdate] status=(${classData.poll.status}) totalResponses=(${Object.keys(classData.students).length}) polls=(${JSON.stringify(responses)}) textRes=(${classData.poll.textRes}) prompt=(${classData.poll.prompt}) weight=(${classData.poll.weight}) blind=(${classData.poll.blind})`)
    
            let totalResponses = 0;
            let totalResponders = 0
            let totalStudentsIncluded = []
            let totalStudentsExcluded = []
            let totalLastResponses = classData.poll.lastResponse
    
            // Add to the included array, then add to the excluded array, then remove from the included array. Do not add the same student to either array
            if (totalLastResponses.length > 0) {
                totalResponses = totalLastResponses.length
                totalStudentsIncluded = totalLastResponses
            } else {
                for (let student of Object.values(classData.students)) {
                    if (student.classPermissions >= TEACHER_PERMISSIONS || student.classPermissions == GUEST_PERMISSIONS) continue;
                    let included = false;
                    let excluded = false;

                    // Check if the student passes the tags test
                    if (classData.poll.requiredTags.length > 0) {
                        let studentTags = student.tags.split(",");
                        if (classData.poll.requiredTags[0][0] == "0") {
                            if (classData.poll.requiredTags.slice(1).join() == student.tags) {
                                included = true;
                            } else {
                                excluded = true;
                            }
                        } else if (classData.poll.requiredTags[0][0] == "1") {
                            let correctTags = classData.poll.requiredTags.slice(1).filter(tag => studentTags.includes(tag)).length;
                            if (correctTags == classData.poll.requiredTags.length - 1) {
                                included = true;
                            } else {
                                excluded = true;
                            }
                        }
                    }
    
                    // Check if the student's checkbox was checked
                    if (classData.poll.studentBoxes.includes(student.username)) {
                        included = true;
                    } else if (classData.poll.studentBoxes.length > 0) {
                        excluded = true;
                    }
    
                    // Check if they should be in the excluded array
                    if (student.break) {
                        excluded = true;
                    }
    
                    if (classData.poll.studentIndeterminate.includes(student.username)) {
                        excluded = true;
                    }
    
                    // Update the included and excluded lists
                    if (excluded) totalStudentsExcluded.push(student.username);
                    if (included) totalStudentsIncluded.push(student.username);
                }
                totalStudentsIncluded = new Set(totalStudentsIncluded)
                totalStudentsIncluded = Array.from(totalStudentsIncluded)
                totalStudentsExcluded = new Set(totalStudentsExcluded)
                totalStudentsExcluded = Array.from(totalStudentsExcluded)
            }
    
    
            totalResponses = totalStudentsIncluded.length
            if (totalResponses == 0 && totalStudentsExcluded.length > 0) {
                // Make total students be equal to the total number of students in the class minus the number of students who failed the perm check
                totalResponders = Object.keys(classData.students).length - totalStudentsExcluded.length
            } else if (totalResponses == 0) {
                totalStudentsIncluded = Object.keys(classData.students)
                for (let i = totalStudentsIncluded.length - 1; i >= 0; i--) {
                    let student = totalStudentsIncluded[i];
                    if (classData.students[student].classPermissions >= TEACHER_PERMISSIONS || classData.students[student].classPermissions == GUEST_PERMISSIONS) {
                        totalStudentsIncluded.splice(i, 1);
                    }
                }
                totalResponders = totalStudentsIncluded.length
            }
            
            if (classInformation[classCode].poll.multiRes) {
                for (let student of Object.values(classData.students)) {
                    if (student.pollRes.buttonRes.length > 1) {
                        totalResponses += student.pollRes.buttonRes.length - 1
                    }
                }
            } else {
                for (let value of Object.values(classData.students)) {
                    if (value.pollRes.buttonRes != "" || value.pollRes.textRes != "") {
                        totalResponses++;
                    }
                }
            }
    
            // Get rid of students whos permissions are teacher or above or guest
            classInformation[classCode].poll.allowedResponses = totalStudentsIncluded
            classInformation[classCode].poll.unallowedResponses = totalStudentsExcluded
    
            advancedEmitToClass('vbUpdate', classCode, { classPermissions: CLASS_SOCKET_PERMISSIONS.vbUpdate }, {
                status: classData.poll.status,
                totalResponders: totalResponders,
                totalResponses: totalResponses,
                polls: responses,
                textRes: classData.poll.textRes,
                prompt: classData.poll.prompt,
                weight: classData.poll.weight,
                blind: classData.poll.blind,
                time: classData.timer.time,
                sound: classData.timer.sound,
                active: classData.timer.active,
                timePassed: classData.timer.timePassed,
            })
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    pollUpdate(classCode = this.socket.request.session.class) {
        try {
            logger.log('info', `[pollUpdate] classCode=(${classCode})`)
            logger.log('verbose', `[pollUpdate] poll=(${JSON.stringify(classInformation[classCode].poll)})`)
    
            advancedEmitToClass(
                'pollUpdate',
                classCode,
                { classPermissions: CLASS_SOCKET_PERMISSIONS.pollUpdate },
                classInformation[this.socket.request.session.class].poll
            )
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    modeUpdate(classCode = this.socket.request.session.class) {
        try {
            logger.log('info', `[modeUpdate] classCode=(${classCode})`)
            logger.log('verbose', `[modeUpdate] mode=(${classInformation[classCode].mode})`)
    
            advancedEmitToClass(
                'modeUpdate',
                classCode,
                { classPermissions: CLASS_SOCKET_PERMISSIONS.modeUpdate },
                classInformation[this.socket.request.session.class].mode
            )
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    quizUpdate(classCode = this.socket.request.session.class) {
        try {
            logger.log('info', `[quizUpdate] classCode=(${classCode})`)
            logger.log('verbose', `[quizUpdate] quiz=(${JSON.stringify(classInformation[classCode].quiz)})`)
    
            advancedEmitToClass(
                'quizUpdate',
                classCode,
                { classPermissions: CLASS_SOCKET_PERMISSIONS.quizUpdate },
                classInformation[this.socket.request.session.class].quiz
            )
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    lessonUpdate(classCode = this.socket.request.session.class) {
        try {
            logger.log('info', `[lessonUpdate] classCode=(${classCode})`)
            logger.log('verbose', `[lessonUpdate] lesson=(${JSON.stringify(classInformation[classCode].lesson)})`)
    
            advancedEmitToClass(
                'lessonUpdate',
                classCode,
                { classPermissions: CLASS_SOCKET_PERMISSIONS.lessonUpdate },
                classInformation[this.socket.request.session.class].lesson
            )
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    pluginUpdate(classCode = this.socket.request.session.class) {
        try {
            logger.log('info', `[pluginUpdate] classCode=(${classCode})`)
    
            database.all(
                'SELECT plugins.id, plugins.name, plugins.url FROM plugins JOIN classroom ON classroom.key=?',
                [classCode],
                (err, plugins) => {
                    try {
                        if (err) throw err
    
                        logger.log('verbose', `[pluginUpdate] plugins=(${JSON.stringify(plugins)})`)
    
                        advancedEmitToClass(
                            'pluginUpdate',
                            classCode,
                            { classPermissions: CLASS_SOCKET_PERMISSIONS.pluginUpdate },
                            plugins
                        )
                    } catch (err) {
                        logger.log('error', err.stack);
                    }
                }
            )
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    customPollUpdate(username) {
        try {
            logger.log('info', `[customPollUpdate] username=(${username})`)
            let userSession = userSockets[username].request.session
            let userSharedPolls = classInformation[userSession.class].students[userSession.username].sharedPolls
            let userOwnedPolls = classInformation[userSession.class].students[userSession.username].ownedPolls
            let userCustomPolls = Array.from(new Set(userSharedPolls.concat(userOwnedPolls)))
            let classroomPolls = structuredClone(classInformation[userSession.class].sharedPolls)
            let publicPolls = []
            let customPollIds = userCustomPolls.concat(classroomPolls)
    
            logger.log('verbose', `[customPollUpdate] userSharedPolls=(${userSharedPolls}) userOwnedPolls=(${userOwnedPolls}) userCustomPolls=(${userCustomPolls}) classroomPolls=(${classroomPolls}) publicPolls=(${publicPolls}) customPollIds=(${customPollIds})`)
    
            database.all(
                `SELECT * FROM custom_polls WHERE id IN(${customPollIds.map(() => '?').join(', ')}) OR public = 1 OR owner=?`,
                [
                    ...customPollIds,
                    userSession.userId
                ],
                (err, customPollsData) => {
                    try {
                        if (err) throw err
    
                        for (let customPoll of customPollsData) {
                            customPoll.answers = JSON.parse(customPoll.answers)
                        }
    
                        customPollsData = customPollsData.reduce((newObject, customPoll) => {
                            try {
                                newObject[customPoll.id] = customPoll
                                return newObject
                            } catch (err) {
                                logger.log('error', err.stack);
                            }
                        }, {})
    
                        for (let customPoll of Object.values(customPollsData)) {
                            if (customPoll.public) {
                                publicPolls.push(customPoll.id)
                            }
                        }
    
                        logger.log('verbose', `[customPollUpdate] publicPolls=(${publicPolls}) classroomPolls=(${classroomPolls}) userCustomPolls=(${userCustomPolls}) customPollsData=(${JSON.stringify(customPollsData)})`)
    
                        io.to(`user-${username}`).emit(
                            'customPollUpdate',
                            publicPolls,
                            classroomPolls,
                            userCustomPolls,
                            customPollsData
                        )
                    } catch (err) {
                        logger.log('error', err.stack);
                    }
                }
            )
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    classBannedUsersUpdate(classCode = this.socket.request.session.class) {
        try {
            logger.log('info', `[classBannedUsersUpdate] ip=(${this.socket.handshake.address}) session=(${JSON.stringify(this.socket.request.session)})`)
            logger.log('info', `[classBannedUsersUpdate] classCode=(${classCode})`)
    
            if (!classCode || classCode == 'noClass') return
    
            database.all('SELECT users.username FROM classroom JOIN classusers ON classusers.classId = classroom.id AND classusers.permissions = 0 JOIN users ON users.id = classusers.studentId WHERE classusers.classId=?', classInformation[this.socket.request.session.class].id, (err, bannedStudents) => {
                try {
                    if (err) throw err
    
                    bannedStudents = bannedStudents.map((bannedStudent) => bannedStudent.username)
    
                    advancedEmitToClass(
                        'classBannedUsersUpdate',
                        classCode,
                        { classPermissions: classInformation[classCode].permissions.manageStudents },
                        bannedStudents
                    )
                } catch (err) {
                    logger.log('error', err.stack)
                }
            })
        } catch (err) {
            logger.log('error', err.stack)
        }
    }
    
    classKickUser(username, classCode = this.socket.request.session.class) {
        try {
            logger.log('info', `[classKickUser] username=(${username}) classCode=(${classCode})`)
    
            userSockets[username].leave(`class-${classCode}`)
            classInformation.noClass.students[username] = classInformation[classCode].students[username]
            classInformation.noClass.students[username].classPermissions = null
            userSockets[username].request.session.class = 'noClass'
            userSockets[username].request.session.save()
            delete classInformation[classCode].students[username]
    
            setClassOfApiSockets(classInformation.noClass.students[username].API, 'noClass')
    
            logger.log('verbose', `[classKickUser] cD=(${JSON.stringify(classInformation)})`)
    
            userSockets[username].emit('reload')
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    classKickStudents(classCode) {
        try {
            logger.log('info', `[classKickStudents] classCode=(${classCode})`)
    
            for (let username of Object.keys(classInformation[classCode].students)) {
                if (classInformation[classCode].students[username].classPermissions < TEACHER_PERMISSIONS) {
                    classKickUser(username, classCode)
                }
            }
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    logout(socket) {
        const username = socket.request.session.username
        const userId = socket.request.session.userId
        const classCode = socket.request.session.class
        const className = classInformation[classCode].className
    
        this.socket.request.session.destroy((err) => {
            try {
                if (err) throw err
    
                delete userSockets[username]
                delete classInformation[classCode].students[username]
                this.socket.leave(`class-${classCode}`)
                this.socket.emit('reload')
                this.classPermissionUpdate(classCode)
                this.virtualBarUpdate(classCode)
    
                database.get(
                    'SELECT * FROM classroom WHERE owner=? AND key=?',
                    [userId, classCode],
                    (err, classroom) => {
                        if (err) logger.log('error', err.stack)
                        if (classroom) this.endClass(classroom.key)
                    }
                )
            } catch (err) {
                logger.log('error', err.stack)
            }
        })
    }
    
    async endPoll() {
        try {
            logger.log('info', `[endPoll] ip=(${this.socket.handshake.address}) session=(${JSON.stringify(this.socket.request.session)})`)
    
            let data = { prompt: '', names: [], letter: [], text: [] }
            currentPoll += 1
    
            let dateConfig = new Date()
            let date = `${dateConfig.getMonth() + 1} /${dateConfig.getDate()}/${dateConfig.getFullYear()}`
    
            data.prompt = classInformation[this.socket.request.session.class].poll.prompt
    
            for (const key in classInformation[this.socket.request.session.class].students) {
                data.names.push(classInformation[this.socket.request.session.class].students[key].username)
                data.letter.push(classInformation[this.socket.request.session.class].students[key].pollRes.buttonRes)
                data.text.push(classInformation[this.socket.request.session.class].students[key].pollRes.textRes)
            }
    
            await new Promise((resolve, reject) => {
                database.run(
                    'INSERT INTO poll_history(class, data, date) VALUES(?, ?, ?)',
                    [classInformation[this.socket.request.session.class].id, JSON.stringify(data), date], (err) => {
                        if (err) {
                            logger.log('error', err.stack);
                            reject(new Error(err));
                        } else {
                            logger.log('verbose', '[endPoll] saved poll to history');
                            resolve();
                        };
                    }
                );
            });
    
            let latestPoll = await new Promise((resolve, reject) => {
                database.get('SELECT * FROM poll_history WHERE class=? ORDER BY id DESC LIMIT 1', [
                    classInformation[this.socket.request.session.class].id
                ], (err, poll) => {
                    if (err) {
                        logger.log("error", err.stack);
                        reject(new Error(err));
                    } else resolve(poll);
                });
            });
    
            latestPoll.data = JSON.parse(latestPoll.data);
            classInformation[this.socket.request.session.class].pollHistory.push(latestPoll);
    
            classInformation[this.socket.request.session.class].poll.status = false
    
            logger.log('verbose', `[endPoll] classData=(${JSON.stringify(classInformation[this.socket.request.session.class])})`)
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    async clearPoll(classCode = this.socket.request.session.class) {
        if (classInformation[classCode].poll.status) await endPoll()
    
        classInformation[classCode].poll.responses = {};
        classInformation[classCode].poll.prompt = "";
        classInformation[classCode].poll = {
            status: false,
            responses: {},
            textRes: false,
            prompt: "",
            weight: 1,
            blind: false,
            requiredTags: [],
            studentBoxes: [],
            studentIndeterminate: [],
            lastResponse: [],
            allowedResponses: [],
        };
    }
    
    async endClass(classCode) {
        try {
            logger.log('info', `[endClass] classCode=(${classCode})`)
    
            await advancedEmitToClass('endClassSound', classCode, { api: true })
    
            for (let username of Object.keys(classInformation[classCode].students)) {
                this.classKickUser(username, classCode)
            }
            delete classInformation[classCode]
    
            logger.log('verbose', `[endClass] cD=(${JSON.stringify(classInformation)})`)
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    getOwnedClasses(username) {
        try {
            logger.log('info', `[getOwnedClasses] username=(${username})`)
    
            database.all('SELECT name, id FROM classroom WHERE owner=?',
                [userSockets[username].request.session.userId], (err, ownedClasses) => {
                    try {
                        if (err) throw err
    
                        logger.log('info', `[getOwnedClasses] ownedClasses=(${JSON.stringify(ownedClasses)})`)
    
                        io.to(`user-${username}`).emit('getOwnedClasses', ownedClasses)
                    } catch (err) {
                        logger.log('error', err.stack);
                    }
                }
            )
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    getPollShareIds(pollId) {
        try {
            logger.log('info', `[getPollShareIds] pollId=(${pollId})`)
    
            database.all(
                'SELECT pollId, userId, username FROM shared_polls LEFT JOIN users ON users.id = shared_polls.userId WHERE pollId=?',
                pollId,
                (err, userPollShares) => {
                    try {
                        if (err) throw err
    
                        database.all(
                            'SELECT pollId, classId, name FROM class_polls LEFT JOIN classroom ON classroom.id = class_polls.classId WHERE pollId=?',
                            pollId,
                            (err, classPollShares) => {
                                try {
                                    if (err) throw err
    
                                    logger.log('info', `[getPollShareIds] userPollShares=(${JSON.stringify(userPollShares)}) classPollShares=(${JSON.stringify(classPollShares)})`)
    
                                    this.socket.emit('getPollShareIds', userPollShares, classPollShares)
                                } catch (err) {
                                    logger.log('error', err.stack);
                                }
                            }
                        )
                    } catch (err) {
    
                    }
                }
            )
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    async deleteCustomPolls(userId) {
        try {
            const customPolls = await getAll('SELECT * FROM custom_polls WHERE owner=?', userId)
    
            if (customPolls.length == 0) return
    
            await runQuery('DELETE FROM custom_polls WHERE userId=?', customPolls[0].userId)
    
            for (let customPoll of customPolls) {
                await runQuery('DELETE FROM shared_polls WHERE pollId=?', customPoll.pollId)
            }
        } catch (err) {
            throw err
        }
    }
    
    async deleteClassrooms(userId) {
        try {
            const classrooms = await getAll('SELECT * FROM classroom WHERE owner=?', userId)
    
            if (classrooms.length == 0) return
    
            await runQuery('DELETE FROM classroom WHERE owner=?', classrooms[0].owner)
    
            for (let classroom of classrooms) {
                if (classInformation[classroom.key]) {
                    this.endClass(classroom.key)
                }
    
                await Promise.all([
                    runQuery('DELETE FROM classusers WHERE classId=?', classroom.id),
                    runQuery('DELETE FROM class_polls WHERE classId=?', classroom.id),
                    runQuery('DELETE FROM plugins WHERE classId=?', classroom.id),
                    runQuery('DELETE FROM lessons WHERE class=?', classroom.id)
                ])
            }
        } catch (err) {
            throw err
        }
    }
    
    ipUpdate(type, username) {
        try {
            logger.log('info', `[ipUpdate] username=(${username})`)
    
            let ipList = {}
            if (type == 'whitelist') ipList = whitelistedIps
            else if (type == 'blacklist') ipList = blacklistedIps
    
            if (type) {
                if (username) io.to(`user-${username}`).emit('ipUpdate', type, settings[`${type}Active`], ipList)
                else io.emit('ipUpdate', type, settings[`${type}Active`], ipList)
            } else {
                this.ipUpdate('whitelist', username)
                this.ipUpdate('blacklist', username)
            }
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
    
    async reloadPageByIp(include, ip) {
        for (let userSocket of await io.fetchSockets()) {
            let userIp = user.socket.handshake.address
    
            if (userIp.startsWith('::ffff:')) userIp = userIp.slice(7)
    
            if (
                (include &&
                    userIp.startsWith(ip)
                ) ||
                (
                    !include &&
                    !userIp.startsWith(ip)
                )
            ) {
                user.socket.emit('reload')
            }
        }
    }
    
    timer(sound, active) {
        try {
            let classData = classInformation[this.socket.request.session.class];
    
            if (classData.timer.timeLeft <= 0) {
                clearInterval(runningTimers[this.socket.request.session.class]);
                runningTimers[this.socket.request.session.class] = null;
            }
    
            if (classData.timer.timeLeft > 0 && active) classData.timer.timeLeft--;
    
            if (classData.timer.timeLeft <= 0 && active && sound) {
                advancedEmitToClass('timerSound', this.socket.request.session.class, {
                    classPermissions: Math.max(CLASS_SOCKET_PERMISSIONS.vbTimer, classInformation[this.socket.request.session.class].permissions.sounds),
                    api: true
                });
            }
    
            advancedEmitToClass('vbTimer', this.socket.request.session.class, {
                classPermissions: CLASS_SOCKET_PERMISSIONS.vbTimer
            }, classData.timer);
        } catch (err) {
            logger.log('error', err.stack);
        }
    }
}

module.exports = {
    // Socket information
    runningTimers,
    rateLimits,
    userSockets,

    // Socket functions
    runQuery,
    advancedEmitToClass,
    setClassOfApiSockets,
    SocketUpdates
};