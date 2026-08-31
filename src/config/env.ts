export const config = {
  port: Number(process.env.PORT ?? 3000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/?replicaSet=rs0",
  mongoAppDatabase: process.env.MONGO_APP_DATABASE ?? "enhance_or_bust",
  mongoAppUsername: process.env.MONGO_APP_USERNAME,
  mongoAppPassword: process.env.MONGO_APP_PASSWORD,
  mongoAppDatabaseLog: process.env.MONGO_APP_DATABASE_LOG ?? "enhance_or_bust_log",
  mongoAppUsernameLog: process.env.MONGO_APP_USERNAME_LOG,
  mongoAppPasswordLog: process.env.MONGO_APP_PASSWORD_LOG,
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  redisPassword: process.env.REDIS_PASSWORD,
};
