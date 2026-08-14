#!/bin/bash

# Comprobar si se ha proporcionado un mensaje de commit
if [ "$#" -ne 1 ]; then
  echo "Uso: $0 \"Mensaje del commit\""
  exit 1
fi

COMMIT_MSG="$1"

# Añadir cambios y hacer commit
git add .
git commit -m "$COMMIT_MSG"
git push origin master
