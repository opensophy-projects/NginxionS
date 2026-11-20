 

#ifndef __METRIC_SCRAPER_H__
#define __METRIC_SCRAPER_H__

#include <string>
#include <fstream>
#include <vector>
#include <streambuf>

#include "singleton.h"
#include "debug.h"
#include "component.h"
#include "event.h"
#include "i_rest_api.h"
#include "generic_metric.h"

class MetricScraper
        :
    public Component,
    Singleton::Consume<I_RestApi>
{
public:
    MetricScraper();
    ~MetricScraper();

    void init();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __METRIC_SCRAPER_H__
