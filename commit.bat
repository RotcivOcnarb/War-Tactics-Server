@echo off
set /p id="Enter commit name: "
git add *
git commit -m %id%
git push origin master
pause