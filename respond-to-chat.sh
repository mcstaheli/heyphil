#!/bin/bash
# Quick script to respond to web chat messages
# Usage: ./respond-to-chat.sh "Your response message here"

MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
    echo "Usage: ./respond-to-chat.sh \"Your response message\""
    exit 1
fi

# Load DATABASE_URL from .env
export DATABASE_URL="postgresql://postgres:gOcOEhhjWYhlYGKYEtCsryktTycBEVbH@gondola.proxy.rlwy.net:25917/railway"

# Post the message
DATABASE_URL="$DATABASE_URL" node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const message = process.argv[1];
pool.query('INSERT INTO chat_messages (role, content, user_name) VALUES (\$1, \$2, \$3) RETURNING id', ['assistant', message, 'Phil']).then(result => {
  console.log('✅ Response posted! Message ID:', result.rows[0].id);
  pool.end();
}).catch(err => {
  console.error('❌ Error:', err.message);
  pool.end();
  process.exit(1);
});
" "$MESSAGE"

# Clear typing indicator
DATABASE_URL="$DATABASE_URL" node set-typing.js off > /dev/null 2>&1
