import util from "util";
import fs from 'fs';

////////////////////////////////////////////////////////////////////////////
//GSR processing
////////////////////////////////////////////////////////////////////////////

let isDataUpdated = false;       //To update the GSR session

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

//Save GSR data to a csv file/ used for graphs visualisation
function processGSRoutput(data, nr) {
    let value = parseInt(data), 
        notConnectedvalue = 600;    //600+ when the sensors are not connected
    
    if(value < notConnectedvalue) {
        //Save dat  to a csv file
        let timestamp =  Math.floor(Date.now() / 1000); 
        const data = `\n${timestamp}, ${value}`;

        let filePath = `./data/gsr/gsr_training_data/gsrData${nr}.csv`;     //Creates a file that represent the gsr section for graph visualisation

        if(nr == false) filePath = `./data/gsr/client_graph/gsr_graph.csv`;

        createFileIfNotExists(filePath , "Timestamp,GSR");

        fs.appendFile(filePath, data, "utf-8", (err) => {
            if (err) console.log(err);
            else console.log("GSR data saved: " + value);
        });
    }
}

//Insert data into 3 minuts sections All files
function insertGSRData(data, dataValue, data2) {
    let value = parseInt(dataValue),
        notConnectedvalue = 600;

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
    readJSONFile(FILE_PATHS.GSR_SECTIONS_JSON_PATH, (dataObject) => {
        dataObject.push(gsrSection);                                    // Append new data
        writeJSONFile(FILE_PATHS.GSR_SECTIONS_JSON_PATH, dataObject);   // Rewrite the JSON file
    });
}

//Write gsr emotions
function writeClientGSREmotionsToCSV(data) {
    createFileIfNotExists(FILE_PATHS.CLIENT_EMOTIONS_PATH, "Emotion");

    const csvRow = `${data.startTime},${data.endTime},"${ data.emotion_state }"\n`;

    fs.appendFile(FILE_PATHS.CLIENT_EMOTIONS_PATH, csvRow, "utf-8", (err) => {
        if (err) console.log(err)
    });
}

//Insert the section to csv file
async function writeSectionToCSV(data, callback) {
    try {
        const emotion = await predictGSREmotion(data.gsrData);
        const csvRow = `${data.startTime},${data.finishTime},"[${data.gsrData.join(', ')}]",${emotion}\n`;

        fs.appendFile(FILE_PATHS.GSR_TRAINING_FILE_PATH,  csvRow, (err) => {
            if (err) console.error('Error writing to CSV file:', err)
        });

        let newData = {
            startTime: data.startTime,
            endTime: data.finishTime,
            gsr_section: data.gsrData,
            emotion_state: emotion
        }

        writeClientGSREmotionsToCSV(newData);   //Write emotiuon in a csv file for user interface display
        writeSectionTOJSON(newData);            //Save data in a json file

        // Clear the data for the next section
        data.startTime = null;
        data.finishTime = null;
        data.gsrData = [];

        callback();
    } catch(e) {
        console.log('Error: ', e)
    }
    
}

//Create the file if it doesnt exist
function createFileIfNotExists(filePath, content) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content || '', 'utf-8');
      console.log(`File created: ${filePath}`);
    }
}


export {
    processGSRoutput,
    insertGSRData,
    predictGSREmotion,
}