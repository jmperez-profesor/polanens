#!/bin/bash

# Comprobar si se ha proporcionado un mensaje de commit
if [ "$#" -ne 1 ]; then
  echo "Uso: $0 \"Mensaje del commit\""
  exit 1
fi

COMMIT_MSG="$1"

cp /home/jmperez/.copilot/chats/1f403bae-f489-48c4-a720-59487855139a/*.* .

# Añadir cambios y hacer commit
git add .
git commit -m "$COMMIT_MSG"
git push -u origin master
