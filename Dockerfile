FROM node:24-bookworm-slim AS runtime

WORKDIR /usr/src/app

# Install production dependencies based on lockfile for reproducible builds
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source and build the SvelteKit project
COPY . .
RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=4173
EXPOSE 4173

# Launch the pre-built app using Vite preview
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
