FROM node:14.19 as build
LABEL org.opencontainers.image.authors="utviklere@nlb.no"

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
COPY yarn.lock ./

# Install
RUN yarn install --network-timeout 100000

# Bundle app source
COPY . .
RUN yarn build

# Only use the bundled app from build image
FROM node:14.19
WORKDIR /usr/src/app
COPY --from=build /usr/src/app .
COPY src/swagger.json dist/swagger.json
EXPOSE 443 80
HEALTHCHECK --interval=30s --timeout=10s --start-period=1m CMD http_proxy="" https_proxy="" curl --fail http://${HOST-0.0.0.0}:${PORT:-443}/health || exit 1
CMD [ "npm", "run", "start" ]
