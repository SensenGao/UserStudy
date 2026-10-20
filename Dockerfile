FROM node:26-alpine
WORKDIR /app
COPY package.json server.mjs schema.sql index.html app.js styles.css config.js ./
COPY scripts ./scripts
ENV STUDY_PRIVATE_ROOT=/study-data STUDY_PORT=8900 STUDY_HOST=0.0.0.0
VOLUME /study-data
EXPOSE 8900
CMD ["node", "server.mjs"]
