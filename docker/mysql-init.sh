#!/bin/sh
# Lets the app user create sibling databases (restore targets, test_services runs).
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
GRANT ALL PRIVILEGES ON \`file_management%\`.* TO '$MYSQL_USER'@'%';
SQL
