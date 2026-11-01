FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXAFILE_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/lib ./lib
COPY --from=build /app/scripts ./scripts
RUN mkdir -p /data && chown -R node:node /data /app/.next && chown node:node /app
USER node
EXPOSE 3005
CMD ["npm", "start", "--", "--hostname", "0.0.0.0", "--port", "3005"]
