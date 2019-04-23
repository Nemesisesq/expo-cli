import glob from 'glob';
import sharp from 'sharp';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { ProjectUtils } from 'xdl';
import JsonFile from '@expo/json-file';
import log from '../log';

async function action(projectDir = './', options) {
  log('Optimizing assets...');
  const { exp } = await ProjectUtils.readConfigJsonAsync(projectDir);
  if (exp === null) {
    log.warn('No Expo configuration found. Are you sure this is a project directory?');
    process.exit(1);
  }

  const [assetJson, assetInfo] = await readAssetJsonAsync(projectDir);
  // Keep track of which hash values in assets.json are no longer in use
  const outdated = new Set();
  for (const fileHash in assetInfo) outdated.add(fileHash);

  // Filter out image assets
  let optimized = false;
  const files = getAssetFiles(exp);
  const regex = /\.(png|jpg|jpeg)$/;
  const images = files.filter(file => regex.test(file.toLowerCase()));
  for (const image of images) {
    const hash = calculateHash(image);
    if (assetInfo[hash]) {
      outdated.delete(hash);
      continue;
    }

    const newName = createNewFilename(image);
    await optimizeImage(image, newName);
    optimized = true;

    // Recalculate hash since the image has changed
    const newHash = calculateHash(image);
    assetInfo[newHash] = true;

    if (options.save) {
      if (hash === newHash) {
        log.warn(`Compressed asset ${image} is identical to the original.`);
        fs.unlinkSync(newName);
      } else {
        // Save the old hash to prevent reoptimizing
        assetInfo[hash] = true;
      }
    } else {
      // Delete the renamed original asset
      fs.unlinkSync(newName);
    }
  }
  if (!optimized) {
    log('No assets optimized! Everything is fully compressed.');
  }
  // Remove assets that have been deleted/modified from assets.json
  outdated.forEach(outdatedHash => {
    delete assetInfo[outdatedHash];
  });
  assetJson.writeAsync(assetInfo);
}

/*
 * Calculate SHA256 Checksum value of a file based on its contents
 */
const calculateHash = file => {
  const contents = fs.readFileSync(file);
  return crypto
    .createHash('sha256')
    .update(contents)
    .digest('hex');
};

/*
 * Compress an inputted jpg or png and save original copy with .expo extension
 */
const optimizeImage = async (image, newName) => {
  log('Optimizing', image);
  // Rename the file with .expo extension
  fs.copyFileSync(image, newName);

  // Extract the format and compress
  const buffer = await sharp(image).toBuffer();
  const { format } = await sharp(buffer).metadata();
  if (format === 'jpeg') {
    await sharp(newName)
      .jpeg({ quality: 75 })
      .toFile(image)
      .catch(err => log.error(err));
  } else {
    await sharp(newName)
      .png({ quality: 75 })
      .toFile(image)
      .catch(err => log.error(err));
  }
};

/*
 * Find all assets under assetBundlePatterns in app.json excluding node_modules
 */
const getAssetFiles = exp => {
  const { assetBundlePatterns } = exp;
  const files = [];
  assetBundlePatterns.forEach(pattern => {
    files.push(...glob.sync(pattern, { ignore: '**/node_modules/**' }));
  });
  return files;
};

/*
 * Read the contents of assets.json under .expo-shared folder. Create the file/directory if they don't exist.
 */
const readAssetJsonAsync = async projectDir => {
  const dirPath = path.join(projectDir, '.expo-shared');
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }

  const assetJson = new JsonFile(path.join(dirPath, 'assets.json'));
  if (!fs.existsSync(assetJson.file)) {
    await assetJson.writeAsync({});
  }
  const assetInfo = await assetJson.readAsync();
  return [assetJson, assetInfo];
};

/*
 * Add .expo extension to a filename in a path string
 */
const createNewFilename = image => {
  const { dir, name, ext } = path.parse(image);
  return dir + '/' + name + '.expo' + ext;
};

export default program => {
  program
    .command('optimize [project-dir]')
    .alias('o')
    .description('Compress the assets in your expo project')
    .option('-s, --save', 'Save the original assets with the extension .expo')
    .allowOffline()
    .asyncAction(action);
};
