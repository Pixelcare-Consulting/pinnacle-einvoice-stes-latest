const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const { getTokenSession } = require('../services/token-prisma.service');
const authConfig = require('./auth.config');
const { LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../services/logging-prisma.service');
const prisma = require('../src/lib/prisma');

// Passport Configuration
passport.use(new LocalStrategy({
    usernameField: authConfig.passport.usernameField,
    passwordField: authConfig.passport.passwordField,
    passReqToCallback: true
  },
  async (req, username, password, done) => {
    try {
      console.log(`Authentication attempt for user: ${username}`);
      console.log('=== LOGIN ATTEMPT DETAILS ===');
      console.log('Username/Email:', username);
      console.log('IP Address:', req.ip || 'unknown');

      // Find user - allow login with username or email
      const user = await prisma.wP_USER_REGISTRATION.findFirst({
        where: {
          OR: [
            { Username: username },
            { Email: username }
          ],
          ValidStatus: '1'
        }
      });

      if (!user) {
        console.log(`User not found: ${username}`);
        console.log('=== LOGIN FAILED: USER NOT FOUND ===');
        return done(null, false, { message: 'Invalid credentials' });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.Password);
      if (!isValid) {
        console.log(`Invalid password for user: ${username}`);
        console.log('=== LOGIN FAILED: INVALID PASSWORD ===');
        return done(null, false, { message: 'Invalid credentials' });
      }

      console.log(`Authentication successful for user: ${username}`);
      console.log('=== LOGIN SUCCESSFUL ===');
      console.log('User ID:', user.ID);
      console.log('Username:', user.Username);
      console.log('Email:', user.Email);
      console.log('Admin Status:', user.Admin === 1 ? 'Yes' : 'No');
      console.log('Admin Value:', user.Admin);

      // Update last login time
      await prisma.wP_USER_REGISTRATION.update({
        where: { ID: user.ID },
        data: { LastLoginTime: new Date() }
      });

      // Log successful login
      try {
        await prisma.wP_LOGS.create({
          data: {
            Description: `User login: ${user.Username}`,
            CreateTS: new Date().toISOString(),
            LoggedUser: user.Username,
            IPAddress: req.ip || 'unknown',
            LogType: LOG_TYPES.INFO,
            Module: MODULES.SYSTEM,
            Action: ACTIONS.LOGIN,
            Status: STATUS.SUCCESS,
            UserID: user.ID
          }
        });
      } catch (logError) {
        console.error('Error logging login:', logError);
      }

      // Get LHDN token if needed
      try {
        // Use getTokenSession to utilize caching and file storage
        const accessToken = await getTokenSession();
        user.accessToken = accessToken; // Attach token to user object for session serialization
        console.log('LHDN Access Token obtained:', !!accessToken);
      } catch (tokenError) {
        console.error('LHDN Token acquisition error during login:', tokenError);
        // Continue login even if token acquisition fails, but log the warning
        // The user object will not have the accessToken in this case
      }

      return done(null, user);
    } catch (error) {
      console.error('Authentication error:', error);
      console.log('=== LOGIN FAILED: SERVER ERROR ===');
      return done(error);
    }
  }
));

// Serialize user for the session
passport.serializeUser((user, done) => {
  try {
    console.log(`Serializing user: ${user.Username} (ID: ${user.ID})`);
    const sessionUser = {
      id: user.ID,
      username: user.Username,
      admin: user.Admin === 1,
      IDType: user.IDType,
      IDValue: user.IDValue,
      TIN: user.TIN,
      Email: user.Email,
      fullName: user.FullName,
      profilePicture: user.ProfilePicture,
      lastLoginTime: new Date(),
      isActive: true
    };

    // Log only essential authentication information
    console.log('=== AUTHENTICATION DETAILS ===');
    console.log('User ID:', user.ID);
    console.log('Username:', user.Username);
    console.log('Is Admin:', user.Admin === 1 ? 'Yes' : 'No');
    console.log('Admin Value:', user.Admin);
    console.log('Access Token:', user.accessToken ? 'Present' : 'Not present');
    console.log('=== END AUTHENTICATION DETAILS ===');

    done(null, sessionUser);
  } catch (error) {
    console.error('Error serializing user:', error);
    done(error);
  }
});

// Deserialize user from the session
passport.deserializeUser(async (sessionUser, done) => {
  try {
    if (!sessionUser || !sessionUser.id) {
      console.log('Invalid session user data');
      return done(null, false);
    }

    // Try to find the user
    const user = await prisma.wP_USER_REGISTRATION.findUnique({
      where: {
        ID: sessionUser.id,
        ValidStatus: '1'
      },
      select: {
        ID: true,
        Username: true,
        Email: true,
        Admin: true,
        ValidStatus: true,
        LastLoginTime: true,
        TIN: true,
        IDType: true,
        IDValue: true,
        FullName: true
      }
    });

    if (!user) {
      console.log(`User not found for ID: ${sessionUser.id}`);
      return done(null, false);
    }

    // Merge session data with fresh user data
    const userData = {
      ...sessionUser,
      ...user
    };

    done(null, userData);
  } catch (error) {
    console.error('Error deserializing user:', error);
    done(error);
  }
});

module.exports = passport;
