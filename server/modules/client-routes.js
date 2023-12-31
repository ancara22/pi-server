import express from 'express';
import ini from 'ini';
import fs from 'fs';
import csv from 'csv-parser';
import path from "path";
import { saveData } from './utility.js';
import { FILE_PATHS } from './server_settings.js';
import { SERVER_CONFIG } from './server_settings.js';
import { rigControl } from './rig_controller.js';
import { resetCSVFile } from './file_cleaners.js';



//////////////////////////////////////////////////////////////////////////////////
//Clien web-service
//////////////////////////////////////////////////////////////////////////////////

const webClientRoutes = express.Router();

//Web interface/web page
webClientRoutes.get("/", (req, res) => res.sendFile(path.join(__dirname, '/webclient/index.html')));

//Get rig status for the web client /Web client webservice
webClientRoutes.get('/rigStatus', (req, res) => res.json({
    rigActive: SERVER_CONFIG.rigActive,
    imagesNumber: SERVER_CONFIG.imagesNumber,
    audioNumber: SERVER_CONFIG.audioNumber,
    gsrNumber: SERVER_CONFIG.gsrNumber
}));

//Save new configs to the file
webClientRoutes.get("/rigStart", (req, res) => {
    resetCSVFile(FILE_PATHS.CLIENT_GSR_GRAPH_FILE_PATH, 'Timestamp,GSR');
    resetCSVFile(FILE_PATHS.CLIENT_EMOTIONS_PATH, 'startTime,endTime,Emotion\n');
    handleRigControl(req, res, "start")
});

//Save new configs to the file
webClientRoutes.get("/rigStop", (req, res) => handleRigControl(req, res, "stop"));

//Get gsr data from the file
webClientRoutes.get('/gsrData', (req, res) => {
    readFileAndHandleErrors(FILE_PATHS.CLIENT_GSR_GRAPH_FILE_PATH, res, (data) => {
        let rows = data.trim().split('\n'),
            header = rows[0].split(','),
            gsr_data = rows.slice(1).map(row => row.split(',').map(parseFloat));

        res.status(200).json({ header, gsr_data });
    })
});

//getRigConfigFile
webClientRoutes.get('/getConfig', (req, res) => {
    readFileAndHandleErrors(FILE_PATHS.CONFIG_FILE_PATH, res, (data) => {
        const config = ini.parse(data)
        res.status(200).json({ config });
    })
});

//Save new configs to the file
webClientRoutes.post("/saveConfig", (req, res) => {
    const config = req.body.config,
        iniConfig = ini.stringify(config);

    fs.writeFile(FILE_PATHS.CONFIG_FILE_PATH, iniConfig, (err) => {
        if (err) {
            config.toUpdateConfig = false;
            console.error('Error saving INI file:', err);
            res.status(500);
        } else {
            config.toUpdateConfig = true;
            rigControl('config');
            res.status(200);
        }
    });
});

//Save new configs to the file
webClientRoutes.get("/getEmotions", (req, res) => {
    readFileAndHandleErrors(FILE_PATHS.CLIENT_EMOTIONS_PATH, res, (data) => {
        let rows = data.trim().split('\n'),
            header = rows[0].split(','),
            emotions = rows.slice(1).map(row => row.split(','));

        res.status(200).json({ header, emotions });
    });
});

//Set the new username and session start time
webClientRoutes.post('/setNewUserName', (req, res) => {
    let name = req.body.userName;

    readFileAndHandleErrors(FILE_PATHS.USER_FILE_PATH, res, (data) => {
        let userData = JSON.parse(data); //Get the data from the json file

        userData.sessionStart = Math.floor(Date.now() / 1000);
        userData.currentUser = name;

        let updatedData = JSON.stringify(userData, null, 4);

        //Rewrite the json file
        fs.writeFile(FILE_PATHS.USER_FILE_PATH, updatedData, 'utf8', (err) => {
            if (err) console.error('Error updating JSON file:', err)
        })

        res.status(200)
    })
})

//Get the user name and session start time
webClientRoutes.get('/getUserName', (req, res) => {
    readFileAndHandleErrors(FILE_PATHS.USER_FILE_PATH, res, (data) => {
        res.send(data);
    })
})

//Get Extracted Audio text
webClientRoutes.get('/getAudioText', (req, res) => {
    readFileAndHandleErrors(FILE_PATHS.AUDIO_TEXT_FILE_PATH, res, (data) => {
        res.send(data)
    })
});

//Get extracted Image text
webClientRoutes.get('/getImageText', (req, res) => {
    readCsvAndHandleErrors(FILE_PATHS.IMAGE_TEXT_FILE_PATH, res, (data) => {
        res.json(data)
    })
});

//Save audio user intro
webClientRoutes.post("/saveAudioIntro", saveData('user', 'audio'), (req, res) => {
    res.json({
        success: true,
        message: 'Audio data saved successfully.'
    });
});

webClientRoutes.get("/getAllSessions", (req, res) => {
    let sessionsFiles = findTheSessionsJsonFiles(FILE_PATHS.SESSION_FOLDER);

    res.json(sessionsFiles);
});



//Read a JSON file function with callback
function readFileAndHandleErrors(filePath, res, callback) {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error(err);
            res.status(500);
        } else {
            callback(data);
        }
    });
}

//Handle rig control
function handleRigControl(req, res, action) {
    rigControl(action);
    res.status(200);
}

//Read CSV file
function readCsvAndHandleErrors(filePath, res, callback) {
    try {
        const data = [];

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                data.push(row);
            })
            .on('end', () => {
                // Transform data and extract information
                const transformedData = data.map((item) => {
                    const imageNameMatch = item.image.match(/(\d+)-stream\.jpg/),
                        imageId = imageNameMatch ? imageNameMatch[1] : null;

                    return {
                        imageName: item.image,
                        imageTime: new Date(parseInt(imageId) * 1000).toLocaleString(),
                        text: item.text,
                    };
                });

                callback(transformedData);
            }).on('error', (err) => {
                console.error('Error reading CSV:', err);
                res.status(500).send('Internal Server Error');
            });
    } catch (err) {
        console.log('Error reading CSV file: ', err);
    }
}


//Scan the sessions filder and return all the session json files
function findTheSessionsJsonFiles(folderPath) {
    fs.readdir(folderPath, (err, files) => {
        if (err) {
            console.error('Error reading folder:', err);
            return;
        }

        //Filter files with the extension '.json'
        const matchingFiles = files.map(file => {
            const extension = path.extname(file),
                fileName = path.basename(file, extension);

            if(extension === '.json') return fileName;
        })

        return matchingFiles
    });
}





export {
    webClientRoutes
}