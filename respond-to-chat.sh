#!/bin/bash
# Quick script to respond to web chat messages
# Usage: ./respond-to-chat.sh "Your response message here"

MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
    echo "Usage: ./respond-to-chat.sh \"Your response message\""
    exit 1
fi

DATABASE_URL="postgresql://postgres:gOcOEhhjWYhlYGKYEtCsryktTycBEVbH@gondola.proxy.rlwy.net:25917/railway"

# Post the message
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const message = process.argv[1];
pool.query('INSERT INTO chat_messages (role, content, user_name) VALUES (\$1, \$2, \$3) RETURNING id', ['assistant', message, 'Phil']).then(result => {
  console.log('✅ Response posted! Message ID:', result.rows[0].id);
  pool.end();
}).catch(err => {
  console.error('❌ Error:', err);
  pool.end();
});
" "$MESSAGE"

# Clear typing indicator
node set-typing.js off > /dev/null 2>&1
