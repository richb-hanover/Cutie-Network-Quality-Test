#! /bin/bash
# "One button" deploy script to roll out new version of TestMyInter.net
# Pull the new repo from Github
# Request credentials to read from private repo
# Run `yarn build` to create the proper files in build/

# To run this script:
#   ssh deploy@...
#   cd /home/testmyinter/Testmyinter.net
#   sudo sh deploy.sh

# add NVM so that yarn can find node (oh the tangled we we weave...)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm

# Retrieve newest files from the repo
#     - supply user name (richb-hanover)
#     - supply Personal Access Token
git pull

# pull all the dependencies
npm install

# build the app
npm run build

# Replace the public_html (toplevel) directory with the newly-built version
# cd ..                                         # move up
# sudo rm -rf public_html                       # ding the old one
# sudo mv TestMyInter.net/build public_html     # replace with the newly-rebuilt
# sudo chown www-data:www-data -R public_html   # change owner to make web pages

# # testmyinterimages.net is served from a CDN, so needs its own copy of the images
# # Copy the entire directory from public/imagestoplevel directory
# # to IMAGESTOPLEVEL - the top level directory of testmyinterimages.net
# REPOTOPLEVEL="/home/testmyinter/TestMyInter.net/public/imagestoplevel*"
# IMAGESTOPLEVEL="/home/testmyinterimages/public_html/"
# # sudo cp -p public/.htaccess $IMAGESTOPLEVEL
# # sudo cp -p public/images-index.html $IMAGESTOPLEVEL/index.html
# sudo cp -pR $REPOTOPLEVEL       $IMAGESTOPLEVEL
# sudo chown www-data:www-data -R $IMAGESTOPLEVEL

# # and restart the apache server
# sudo apachectl restart

echo "All set! Check at http://netperf.bufferbloat.net:4173"
