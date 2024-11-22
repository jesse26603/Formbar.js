const { classInformation } = require("./class")
const { database } = require("./database")
const { logger } = require("./logger")
const { io } = require("./webServer")

/**
 * Asynchronous function to get the current user's data.
 * @param {Object} req - The request object.
 * @returns {Promise|Object} A promise that resolves to the user's data or an error object.
 */
async function getUser(api) {
    try {
        // Log the request details
        logger.log('info', `[getUser]`)

        // Get the username associated with the API key in the request headers
        let username = await getUsername(api)

        // If the username is an instance of Error, throw the error
        if (username instanceof Error) throw username
        
        // If an error occurs, return the error
        if (username.error) return username

        // Get the class code of the user
        let classCode = getUserClass(username)

        // If the class code is an instance of Error, throw the error
        if (classCode instanceof Error) throw classCode

        // Query the database for the user's data
        let dbUser = await new Promise((resolve, reject) => {
            // If the user is not in any class
            if (!classCode || classCode == 'noClass') {
                // Query the database for the user's data
                database.get(
                    'SELECT id, username, permissions, NULL AS classPermissions FROM users WHERE username = ?',
                    [username],
                    (err, dbUser) => {
                        try {
                            // If an error occurs, throw the error
                            if (err) throw err

                            // If no user is found, resolve the promise with an error object
                            if (!dbUser) {
                                resolve({ error: 'user does not exist' })
                                return
                            }

                            // If a user is found, resolve the promise with the user object
                            resolve(dbUser)
                        } catch (err) {
                            // If an error occurs, reject the promise with the error
                            reject(err)
                        }
                    }
                )
                return
            }

            // If the user is in a class, query the database for the user's data and class permissions
            database.get(
                'SELECT users.id, users.username, users.permissions, CASE WHEN users.id = classroom.owner THEN 5 ELSE classusers.permissions END AS classPermissions FROM users INNER JOIN classusers ON users.id = classusers.studentId OR users.id = classroom.owner INNER JOIN classroom ON classusers.classId = classroom.id WHERE classroom.key = ? AND users.username = ?',
                [classCode, username],
                (err, dbUser) => {
                    try {
                        // If an error occurs, throw the error
                        if (err) throw err

                        // If no user is found, resolve the promise with an error object
                        if (!dbUser) {
                            resolve({ error: 'user does not exist in this class' })
                            return
                        }

                        // If a user is found, resolve the promise with the user object
                        resolve(dbUser)
                    } catch (err) {
                        // If an error occurs, reject the promise with the error
                        reject(err)
                    }
                }
            )
        })
        
        // If an error occurs, return the error
        if (dbUser.error) return dbUser

        // Create an object to store the user's data
        let userData = {
            loggedIn: false,
            ...dbUser,
            help: null,
            break: null,
            quizScore: null,
            pogMeter: null,
            class: classCode
        }

        // If the user is in a class and is logged in
        if (classInformation[classCode] && classInformation[classCode].students && classInformation[classCode].students[dbUser.username]) {
            let cdUser = classInformation[classCode].students[dbUser.username]
            if (cdUser) {
                // Update the user's data with the data from the class
                userData.loggedIn = true
                userData.help = cdUser.help
                userData.break = cdUser.break
                userData.quizScore = cdUser.quizScore
                userData.pogMeter = cdUser.pogMeter
            }
        }

        // Log the user's data
        logger.log('verbose', `[getUser] userData=(${JSON.stringify(userData)})`)

        // Return the user's data
        return userData
    } catch (err) {
        // If an error occurs, return the error
        return err
    }
}

/**
 * Retrieves the class code for a given user.
 *
 * @param {string} username - The username of the user.
 * @returns {string|null|Error} The class code if the user is found, null if the user is not found, or an Error object if an error occurs.
 */
function getUserClass(username) {
	try {
		// Log the username
		logger.log('info', `[getUserClass] username=(${username})`)

		// Iterate over the class codes
		for (let classCode of Object.keys(classInformation)) {
			// If the user is a student in the current class
			if (classInformation[classCode].students[username]) {
				// Log the class code
				logger.log('verbose', `[getUserClass] classCode=(${classCode})`)
				// Return the class code
				return classCode
			}
		}

		// If the user is not found in any class, log null
		logger.log('verbose', `[getUserClass] classCode=(${null})`)
		// Return null
		return null
	} catch (err) {
		// If an error occurs, return the error
		return err
	}
}

/**
 * Asynchronous function to get the username associated with a given API key.
 * @param {string} api - The API key.
 * @returns {Promise<string|Object>} A promise that resolves to the username or an error object.
 */
async function getUsername(api) {
    try {
        // If no API key is provided, return an error
        if (!api) return { error: 'missing api' }

        // Query the database for the username associated with the API key
        let user = await new Promise((resolve, reject) => {
            database.get(
                'SELECT username FROM users WHERE api = ?',
                [api],
                (err, user) => {
                    try {
                        // If an error occurs, throw the error
                        if (err) throw err

                        // If no user is found, resolve the promise with an error object
                        if (!user) {
                            resolve({ error: 'user not found' })
                            return
                        }

                        // If a user is found, resolve the promise with the user object
                        resolve(user)
                    } catch (err) {
                        // If an error occurs, reject the promise with the error
                        reject(err)
                    }
                }
            )
        })

        // If an error occurred, return the error
        if (user.error) return user

        // If no error occurred, return the username
        return user.username
    } catch (err) {
        // If an error occurs, return the error
        return err
    }
}

async function passwordRequest(newPassword, username) {
	if (newPassword && username) {
		let passwordChange = true;
		io.emit("passwordUpdate", passwordChange, username, newPassword);
	};
};


module.exports = {
    getUser,
    getUserClass,
    getUsername,
    passwordRequest,
}