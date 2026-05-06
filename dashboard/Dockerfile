FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js middleware(next-auth getToken)에 시크릿이 빌드 시점에 박혀야 함. 런타임 .env만 주면 401 고착.
ARG NEXTAUTH_SECRET
ARG NEXTAUTH_URL
ARG NEXT_PUBLIC_WEBRTC_ICE_SERVERS
ENV NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
ENV NEXTAUTH_URL=${NEXTAUTH_URL}
ENV NEXT_PUBLIC_WEBRTC_ICE_SERVERS=${NEXT_PUBLIC_WEBRTC_ICE_SERVERS}
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
# migrate deploy만 있으면 migrations 폴더가 비어 있을 때 exit 0→ db push가 스킵되어 테이블이 안 생김.
CMD ["sh", "-c", "npx prisma migrate deploy; npx prisma db push && npx prisma db seed && exec npm run start"]
