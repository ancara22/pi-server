import multer, { diskStorage } from 'multer';
import { Client } from 'ssh2';
import { readdir, unlink } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import fs from 'fs';

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
function rigConfiguration() {
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
            sftp.fastPut('../config.ini', `${rigDirectory}config.ini`, (err) => {
                if (err) {
                    console.error('Error transferring the file:', err);
                    sftp.end(); 
                    ssh.end();
                    return 0;
                }

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

//Save GSR data to a csv file
function processGSRoutput(data, nr) {
    let value = parseInt(data) 
    let notConnectedvalue = 600; //600+ when the sensors are not connected
    
    if(value < notConnectedvalue) {
        //Save dat  to a csv file
        let timestamp = Date.now();
        const data = `\n${timestamp}, ${value}`;

        createFileIfNotExists(`./data/gsr/gsrData${nr}.csv`, "Timestamp,GSR");

        fs.appendFile(`./data/gsr/gsrData${nr}.csv`, data, "utf-8", (err) => {
            if (err) {
                console.log(err);
            } else {
                console.log("GSR data saved: " + value);
            }
        });
    }
}

//Insert data into 3 minuts sections
function insertGSRData(data, dataValue, data2) {
    let value = parseInt(dataValue) 
    let notConnectedvalue = 600;

    if(value < notConnectedvalue) {
        if(data.startTime == null) data.startTime = Date.now();

        data.gsrData.push(value);
    } else {
        data.artefacts ++;
    }

    if(data.artefacts >= 3) {
        data.startTime = Date.now();
        data.artefacts = 0;
    }
   

    processGSRoutput(dataValue, data2.fileNumb);
        
    if(Date.now() - data.startTime >= 3 * 60 * 1000 && data.startTime != null || data.gsrData.length >= 85) {
        data.finishTime = Date.now();
        writeSectionToCSV(data);
        data2.fileNumb++;
         
    }

}

//Insert the section to csv file
function writeSectionToCSV(data) {
    const csvRow = `${data.startTime},${data.finishTime},[${data.gsrData.join(', ')}]\n`;

    fs.appendFile("./data/gsr/gsrSections.csv",  csvRow, (err) => {
        if (err) {
            console.error('Error writing to CSV file:', err);
        }
    });

    // Clear the data for the next section
    data.startTime = null;
    data.finishTime = null;
    data.gsrData = [];
}


//Identify speech in an audio file
function identifySpeachInAudio(audioFIleName) {
    //Run the python audio_transcriber
    exec(`python3 ./processors/audio_transcriber.py ${audioFIleName}`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error: ${error}`);
          return false;
        }
    
        //Get the output
        const outputString = stdout.trim();
        
        if(outputString == 'true') {
            return true;
        } else if(outputString == 'false') {
            return false;
        } else {
            return false;
        }

    
    })
}

//Temp function
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
                    } else {
                        console.log(`Deleted file: ${file}`);
                    }
                });
            }
        });
    });
}


function createFileIfNotExists(filePath, content) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content || '', 'utf-8');
      console.log(`File created: ${filePath}`);
    }
}


export {
    runImageProcessor,
    removeStreamFiles,
    rigConfiguration,
    saveData,
    processGSRoutput,
    identifySpeachInAudio,
    insertGSRData
}