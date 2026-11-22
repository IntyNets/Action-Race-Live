# =============================================================================
# STAGE 1: BUILDER (Biên dịch giao diện Frontend Vite -> dist/)
# =============================================================================
FROM node:22-slim AS builder

WORKDIR /app

ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Chỉ copy package.json để cài đặt chuẩn native modules trên Linux
COPY package.json ./
RUN npm install --no-audit --no-fund

# Copy các file cần thiết để build Frontend
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# Build bản Production tối ưu vào thư mục /app/dist
RUN npm run build

# =============================================================================
# STAGE 2: PRODUCTION RUNNER (Image sạch, gọn nhẹ chỉ chứa file chạy thực tế)
# =============================================================================
FROM node:22-slim AS runner

# Cài đặt chứng chỉ SSL CA (cho TikTok/Facebook/EdgeTTS) và múi giờ Việt Nam
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV TZ=Asia/Ho_Chi_Minh
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3002
ENV USERS_FILE=/app/data/users.json
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Tạo thư mục lưu hồ sơ người chơi bền vững (/app/data)
RUN mkdir -p /app/data

# Copy dependencies và các file chạy Production từ tầng builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY tools ./tools
COPY server.ts ./server.ts

EXPOSE 3002

# Kiểm tra sức khỏe container tự động cho Docker / Portainer / Nginx Proxy Manager
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3002) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
