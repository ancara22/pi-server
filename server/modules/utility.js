import multer, { diskStorage } from 'multer';
import { Client } from 'ssh2';
import fs, { readdir, unlink } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import wav from 'wav';
import Papa from 'papaparse';
import util from "util";

const CONFIG_FILE_PATH = '../config.ini';
const GSR_SECTIONS_JSON_PATH = './data/gsr/gsr_sections.json';
const CLIENT_EMOTIONS_PATH = `./data/gsr/client_graph/client_emotions.csv`;
const GSR_TRAINING_FILE_PATH = "./data/gsr/gsr_training_data/gsr_training.csv";
const AUDIO_TEXT_FILE_PATH = "./data/audio/audio_text.json";
const SESSION_OUTPUT_FILE_PATH = './data/recording_output.json';
const IMAGE_TEXT_FILE_PATH = './data/images/image_text/image_text.csv';




let current_session = "";   //Current session file name
let isDataUpdated = false;  //To update the GSR session


//Save data to a file
function saveData(folder, fileType) {
    const storage = diskStorage({
        destination: (r, f, callback) => {
            callback(null, `data/${folder}/`);
        },
        
        filename: (r, file, callback) => {
            callback(null, file.originalname);
        }
    });

    const upload = multer({ storage: storage });
    return upload.single(fileType);
}

//Send the connfiguration, config.ini file to the raspberry pi
function rigControl(startRig) {
    //SSH connection config
    let config = {
        host: "raspberry.local",
        port: 22,
        username: "rig",
        password: "raspberry"
    }

    const ssh = new Client();

    //On connection ready send the configs
    ssh.on("ready", () => {
        console.log('Connection ready.')

        ssh.sftp((er, sftp) => {
            if(er) console.log("SSH connection is imposible!");
        
            let rigDirectory = "/home/rig/Documents/App/main/";   //Raspberry pi config.ini directory

            //Copy file to the raspberry pi directory
            sftp.fastPut(CONFIG_FILE_PATH, `${rigDirectory}config.ini`, (err) => {
                if (err) {
                    console.error('Error transferring the file:', err);
                    sftp.end(); 
                    ssh.end();
                    return 0;
                }

                if(startRig != 'config') {
                    //Stop all the previews processes
                    ssh.exec('pkill -f python', (err, stream) => {
                        const sleep = (milliseconds) => {
                            return new Promise(resolve => setTimeout(resolve, milliseconds));
                        };

                        if(startRig == 'start') {
                            sleep(1000).then(()=> {
                                // Run the rig recording on the raspberry pi
                                ssh.exec("python3 /home/rig/Documents/App/main/app.py", (err, stream) => {
                                    if (err) {
                                        console.error("Error running the app:", err);
                                        ssh.end();
                                        return;
                                    }
                                    
                                    stream.stderr.on('data', (data) => {
                                        console.error('Python Script Error:', data.toString());
                                
                                    });
                                
                                    stream.on("close", (code, signal) => { 
                                        console.log("Recording process closed. Exit code:", code, "Signal:", signal);
                                        ssh.end();
                                    });
                                });

                                runImageProcessor();  //Rund image processor
                            })
                        }
                    }) 
                }
            })
            
            //On writing close, close the ssh connection
            sftp.on('close', () => {
                ssh.end();
            })
        })
    })

    //On ssh connection error
    ssh.on("error", (err) => {
        console.log('SSH connection error: ', err)
    })

    ssh.connect(config); //Start connection
}


//Run image processor python script, image_processor
function runImageProcessor() {
    exec(`python3 ./processors/image_processor.py`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`Stderr: ${stderr}`);
          return;
        }
        console.log(`Output: ${stdout}`);
    });
}   


////////////////////////////////////////////////////////////////////////////
//GSR DATA PROCESSORS
////////////////////////////////////////////////////////////////////////////

//Predict GSR section emotion
async function predictGSREmotion(inputGSR) {
    try {
        const inputGSRString = inputGSR.join(',');
        const command = `python3 ./processors/gsr_predict_emotion.py ${inputGSRString}`;

        const { stdout, stderr } = await util.promisify(exec)(command);
        const emotion = stdout.trim();

        return emotion;
    } catch(error) {
        console.error(`Error: ${error.message}`);
    }
}


////////////////////////////////////////////////////////////////////////////
//FILE WRITERS
////////////////////////////////////////////////////////////////////////////

//Save GSR data to a csv file/ used for graphs visualisation
function processGSRoutput(data, nr) {
    let value = parseInt(data) 
    let notConnectedvalue = 600; //600+ when the sensors are not connected
    
    if(value < notConnectedvalue) {
        //Save dat  to a csv file
        let timestamp =  Math.floor(Date.now() / 1000); 
        const data = `\n${timestamp}, ${value}`;

        let filePath = `./data/gsr/gsr_training_data/gsrData${nr}.csv`; //Creates a file that represent the gsr section for graph visualisation

        if(nr == false) {
            filePath = `./data/gsr/client_graph/gsr_graph.csv`
        }

        createFileIfNotExists(filePath , "Timestamp,GSR");

        fs.appendFile(filePath, data, "utf-8", (err) => {
            if (err) {
                console.log(err);
            } else {
                console.log("GSR data saved: " + value);
            }
        });
    }
}

//Insert data into 3 minuts sections All files
function insertGSRData(data, dataValue, data2) {
    let value = parseInt(dataValue) 
    let notConnectedvalue = 600;

    if(value < notConnectedvalue) {
        if(data.startTime == null) {
            data.startTime = Math.floor(Date.now() / 1000);
            isDataUpdated = true;
        }
        data.gsrData.push(value);
    } else {
        data.artefacts ++;
    }

    if(data.artefacts >= 3) {
        data.startTime = Math.floor(Date.now() / 1000);
        data.artefacts = 0;
    }

    processGSRoutput(dataValue, data2.fileNumb); //Creates separate files of each section/for manual lm training
    
    if(Math.floor(Date.now() / 1000) - data.startTime >= 3 * 60 && data.startTime != null && (data.gsrData).length >= 85 && isDataUpdated) {
            console.log('yess')
            data.finishTime = Math.floor(Date.now() / 1000); 
            isDataUpdated = false;

            writeSectionToCSV(data, () => {
                data2.fileNumb++;
                isDataUpdated = true;
            });  
           
    }
}

//Append the GSR section to the json output file 
async function writeSectionTOJSON(gsrSection) {
    readJSONFile(GSR_SECTIONS_JSON_PATH, (dataObject) => {
        dataObject.push(gsrSection);                       // Append new data
        writeJSONFile(GSR_SECTIONS_JSON_PATH, dataObject); // Rewrite the JSON file
    });
}

//Write gsr emotions
function writeClientGSREmotionsToCSV(data) {
    createFileIfNotExists(CLIENT_EMOTIONS_PATH, "Emotion");

    const csvRow = `${data.startTime},${data.endTime},"${ data.emotion_state }"\n`;


    fs.appendFile(CLIENT_EMOTIONS_PATH, csvRow, "utf-8", (err) => {
        if (err) {
            console.log(err);
        }
    });
}

//Insert the section to csv file
async function writeSectionToCSV(data, callback) {
    try {
        const emotion = await predictGSREmotion(data.gsrData);
        const csvRow = `${data.startTime},${data.finishTime},"[${data.gsrData.join(', ')}]",${emotion}\n`;

        fs.appendFile(GSR_TRAINING_FILE_PATH,  csvRow, (err) => {
            if (err) {
                console.error('Error writing to CSV file:', err);
            }
        });

        let newData = {
            startTime: data.startTime,
            endTime: data.finishTime,
            gsr_section: data.gsrData,
            emotion_state: emotion
        }

        writeClientGSREmotionsToCSV(newData); //Write emotiuon in a csv file for user interface display
        writeSectionTOJSON(newData);    //Save data in a json file

        // Clear the data for the next section
        data.startTime = null;
        data.finishTime = null;
        data.gsrData = [];

        callback();
    } catch(e) {
        console.log('Error: ', e)
    }
    
}

//Read the json file
function readJSONFile(filePath, callback = (dataObject) => {}) {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading JSON file:', err);
            callback(err, null);
            return;
        }

        const dataObject = JSON.parse(data);
        callback(dataObject);
    });
}

//Write json file
function writeJSONFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(`Error writing JSON file (${filePath}):`, error);
    }
}

//Create the file if it doesnt exist
function createFileIfNotExists(filePath, content) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content || '', 'utf-8');
      console.log(`File created: ${filePath}`);
    }
}



////////////////////////////////////////////////////////////////////////////
//FORMAT THE DATA, MERGE AND SAVE TO A FILE
////////////////////////////////////////////////////////////////////////////

//Create finnal output file
function insertDataToFinalFile() {
    let audioData = readJSONFile(AUDIO_TEXT_FILE_PATH);  //Audio text data
    let gsrData = readJSONFile(GSR_SECTIONS_JSON_PATH );      //GSR data

    let mergedData = []; //Final file content

    //Get the audio timestamp as a section timestamp reference
    audioData.forEach(audioSection => {
        let referenceTimestamp = parseInt(audioSection.timestamp);  //Audio file end timestamp

        //Find the gsr section according to the reference 3 min + - 1
        let gsrSection = gsrData.filter(section => {
            let gsrEndTimestamp = parseInt(section.endTime);
            let dif1 = Math.abs(gsrEndTimestamp - referenceTimestamp);
            let dif2 = Math.abs(referenceTimestamp - gsrEndTimestamp);

            return dif1 < 90 || dif2 < 90;
        })

        //Read the image text csv file
        let imageCsv = fs.readFileSync(IMAGE_TEXT_FILE_PATH, 'utf8');
        let parsedData = Papa.parse(imageCsv, { header: true }); //Parse CSV data

        //Filter all the images data in the interval of 3 min ultin timestamp reference
        let filteredImages = parsedData.data.filter(row => {
            let imageName = row.image,
                timestamp = imageName.match(/(\d+)/);
            
            timestamp = timestamp ? parseInt(timestamp[0]) : null;

            return timestamp && timestamp >= referenceTimestamp - (3 * 60) && timestamp <= referenceTimestamp;
        })

        // Create the final data format
        let merged = {
            endTimestamp: referenceTimestamp,
            audio: audioSection,
            gsr: gsrSection,
            img: filteredImages
        }

        mergedData.push(merged);
    });

    let mergedJson = JSON.stringify(mergedData, null, 2);   //Convert mergedData array to JSON
   
    fs.writeFileSync(SESSION_OUTPUT_FILE_PATH, mergedJson, 'utf8');    // Write the merged data to a new file

    console.log(`Merged data written to ${SESSION_OUTPUT_FILE_PATH}`);
}

//Run the final file content update by interval
function updateTheFinalFile() {
    setInterval(() => {
        insertDataToFinalFile();
    }, 3 * 60 * 1000)
}



////////////////////////////////////////////////////////////////////////////
//REMOVE FILES
////////////////////////////////////////////////////////////////////////////

//Remove images from the directory
function removeStreamFiles(directoryPath) {
    readdir(directoryPath, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return;
        }

        files.forEach((file) => {
            if (file.includes('stream') || file.includes('audio')) {
                const filePath = join(directoryPath, file);
                unlink(filePath, (error) => {
                    if (error) {
                        console.error(`Error deleting file ${file}:`, error);
                    }
                });
            }
        });
    });
}

//Clean old row files
function cleanOldRowData() {
    let folders = ["data/audio/row_audio", "data/images/row_images"];

    folders.forEach(folder => {
        removeStreamFiles(folder);
    });
}


//Concatinate more audio files
function concatinateWavFiles(wavFile) {
    let match = wavFile.match(/(\d+)/),
        fileEndTimestamp = match ? match[0] : null;     //The timestamp from the file name

    let userRecordedFile = "./data/user/userIntro.wav",     //Start audio file for user detection
        filePath = "./data/audio/processed_audio/audio_" + fileEndTimestamp + ".wav";

    //Define the writer
    const writer = new wav.FileWriter(filePath, {
        channels: 1,
        sampleRate: 44100,
        bitDepth: 16
    });

    //Define the reader and handle the excetions
    const reader = new wav.Reader();

    reader.on('format', (format) => {
        if (!writer._writeState) {
            writer.pipe(fs.createWriteStream(userRecordedFile, { flags: 'a' }));
        }
    });

    reader.on('error', (er) => console.log('first', er))

    //Concatinate the files
    fs.createReadStream(wavFile).pipe(reader).pipe(writer, { end: false });

    writer.end();  ///End the writing

    return outputFile;
}




export {
    runImageProcessor,
    removeStreamFiles,
    rigControl,
    saveData,
    processGSRoutput,
    insertGSRData,
    concatinateWavFiles,
    predictGSREmotion,
    updateTheFinalFile,
    cleanOldRowData,
    insertDataToFinalFile
}





