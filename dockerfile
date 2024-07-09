# Use an official Node.js runtime as the base image
FROM node:20

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Define environment variables
ARG NODE_ENV
ARG OPENAI_API_KEY
ARG MONGO_URI
ARG ADMIN_PASSWORD

# Set environment variables
ENV NODE_ENV=$NODE_ENV
ENV OPENAI_API_KEY=$OPENAI_API_KEY
ENV MONGO_URI=$MONGO_URI
ENV ADMIN_PASSWORD=$ADMIN_PASSWORD

# Command to run the application
CMD ["node", "index.js"]
