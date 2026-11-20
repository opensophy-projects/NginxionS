 

package main

import (
	"context"
	"os"
	"time"

	"openappsec.io/log"
	"openappsec.io/smartsync-service/internal/app"
	"openappsec.io/smartsync-service/internal/app/ingector"
)

const (
	initTimeout    = 15
	stopTimeout    = 15
	exitCauseError = 1
	exitCauseDone  = 0

	envKeyMode = "APPSEC_MODE"
)

func main() {
	initCtx, initCancel := context.WithTimeout(context.Background(), initTimeout*time.Second)

	appsecMode := os.Getenv(envKeyMode)
	isStandAloneMode := appsecMode == "standalone" || appsecMode == "stand-alone"
	var app *app.App
	var err error
	if isStandAloneMode {
		app, err = ingector.InitializeStandAloneApp(initCtx)
		if err != nil {
			log.WithContext(initCtx).Error("Failed to inject dependencies! Error: ", err.Error())
			initCancel()
			os.Exit(exitCauseError)
		}
	} else {
		app, err = ingector.InitializeApp(initCtx)
		if err != nil {
			log.WithContext(initCtx).Error("Failed to inject dependencies! Error: ", err.Error())
			initCancel()
			os.Exit(exitCauseError)
		}
	}
	initCancel()

	exitCode := exitCauseDone
	if err := app.Start(); err != nil {
		log.WithContext(initCtx).Error("Failed to start app: ", err.Error())
		exitCode = exitCauseError
	}

	stopCtx, stopCancel := context.WithTimeout(context.Background(), stopTimeout*time.Second)
	if errs := app.Stop(stopCtx); len(errs) > 0 {
		log.WithContext(context.Background()).Error("Failed to stop app: ", errs)
		exitCode = exitCauseError
	}

	stopCancel()
	os.Exit(exitCode)
}
