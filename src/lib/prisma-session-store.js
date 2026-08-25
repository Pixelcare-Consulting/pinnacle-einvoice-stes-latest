const session = require('express-session');
const prisma = require('./prisma');

class PrismaSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.ttl = options.ttl || 86400; // Default: 1 day
    this.prisma = options.prisma || prisma;
    this.createTable();
  }

  async createTable() {
    // Check if the Session table exists in the schema
    // If not, you would need to create it via a migration
    // This is just a placeholder - Prisma requires schema changes via migrations
    console.log('Using Prisma Session Store');
  }

  async get(sid, callback) {
    try {
      const sessionData = await this.prisma.session.findUnique({
        where: { sid },
      });

      if (!sessionData) {
        return callback(null, null);
      }

      // Check if session is expired
      if (sessionData.expires < new Date()) {
        await this.destroy(sid);
        return callback(null, null);
      }

      const session = JSON.parse(sessionData.data);
      return callback(null, session);
    } catch (error) {
      return callback(error);
    }
  }

  async set(sid, session, callback) {
    try {
      const expires = new Date(Date.now() + (session.cookie.maxAge || this.ttl * 1000));
      const sessionData = {
        sid,
        data: JSON.stringify(session),
        expires,
      };

      await this.prisma.session.upsert({
        where: { sid },
        update: sessionData,
        create: sessionData,
      });

      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async destroy(sid, callback = () => {}) {
    try {
      await this.prisma.session.delete({
        where: { sid },
      });
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async touch(sid, session, callback) {
    try {
      const expires = new Date(Date.now() + (session.cookie.maxAge || this.ttl * 1000));

      await this.prisma.session.update({
        where: { sid },
        data: { expires },
      });

      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async clear(callback) {
    try {
      await this.prisma.session.deleteMany({});
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async length(callback) {
    try {
      const count = await this.prisma.session.count();
      callback(null, count);
    } catch (error) {
      callback(error);
    }
  }

  async all(callback) {
    try {
      const sessions = await this.prisma.session.findMany();
      const result = sessions.map(session => {
        return {
          sid: session.sid,
          expires: session.expires,
          data: JSON.parse(session.data),
        };
      });
      callback(null, result);
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = PrismaSessionStore;
